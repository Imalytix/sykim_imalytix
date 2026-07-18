import dns from "node:dns/promises";
import net from "node:net";

export class SecurityViolationError extends Error {}

const BLOCKED_HOSTNAMES = new Set(["localhost", "169.254.169.254"]);

function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b] = parts;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (incl. link-local + cloud metadata)
  if (a === 127) return true; // loopback
  if (a === 0) return true;
  if (a >= 224) return true; // multicast/reserved
  return false;
}

function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1") return true; // loopback
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 unique local
  if (lower.startsWith("fe80")) return true; // link-local
  if (lower.startsWith("::ffff:")) {
    // IPv4-mapped address — check the embedded IPv4 part too.
    return isBlockedIPv4(lower.replace("::ffff:", ""));
  }
  return false;
}

function isBlockedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isBlockedIPv4(ip);
  if (family === 6) return isBlockedIPv6(ip);
  return true; // unparseable → treat as unsafe
}

async function assertSafeUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SecurityViolationError("유효하지 않은 URL입니다.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SecurityViolationError("http/https URL만 허용됩니다.");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) throw new SecurityViolationError("URL hostname이 필요합니다.");
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new SecurityViolationError("차단된 호스트입니다.");
  }

  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) throw new SecurityViolationError("차단된 IP 주소입니다.");
    return;
  }

  let addresses: string[];
  try {
    const results = await dns.lookup(hostname, { all: true });
    addresses = results.map((r) => r.address);
  } catch {
    throw new SecurityViolationError(`호스트를 확인할 수 없습니다: ${hostname}`);
  }
  if (addresses.length === 0 || addresses.some((ip) => isBlockedIp(ip))) {
    throw new SecurityViolationError("URL이 차단된 IP 주소로 확인됩니다.");
  }
}

export interface SafeFetchResult {
  buffer: Buffer;
  finalUrl: string;
  contentType: string;
}

/**
 * Fetches a remote image while guarding against SSRF: only http/https,
 * no private/loopback/link-local targets (checked pre-connect via DNS,
 * and again on every redirect hop), a manual redirect cap, a content-type
 * allowlist, and a hard byte-size ceiling enforced while streaming.
 */
export async function safeFetchImage(url: string, maxBytes: number, timeoutMs: number): Promise<SafeFetchResult> {
  let currentUrl = url;

  for (let redirects = 0; ; redirects++) {
    await assertSafeUrl(currentUrl);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(currentUrl, {
        redirect: "manual",
        headers: { "User-Agent": "Imalytix/0.1" },
        signal: controller.signal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SecurityViolationError(`이미지 다운로드 실패: ${message}`);
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects >= 3) throw new SecurityViolationError("Redirect 횟수가 너무 많습니다.");
      const location = response.headers.get("location");
      if (!location) throw new SecurityViolationError("Redirect Location 헤더가 없습니다.");
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    if (response.status >= 400) {
      throw new SecurityViolationError(`이미지 다운로드 실패: HTTP ${response.status}`);
    }

    const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (contentType && !contentType.startsWith("image/")) {
      throw new SecurityViolationError("이미지 Content-Type이 아닙니다.");
    }

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > maxBytes) {
      throw new SecurityViolationError("다운로드된 이미지가 너무 큽니다.");
    }

    if (!response.body) throw new SecurityViolationError("응답 본문이 없습니다.");

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new SecurityViolationError("다운로드된 이미지가 너무 큽니다.");
      }
      chunks.push(value);
    }

    return { buffer: Buffer.concat(chunks), finalUrl: currentUrl, contentType };
  }
}
