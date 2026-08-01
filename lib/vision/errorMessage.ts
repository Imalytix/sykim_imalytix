/**
 * Machine-checkable reason a provider call failed — kept separate from the
 * human-readable message so callers (logs, dashboards, alerting) can filter/
 * group on it without parsing Korean prose. Every VisionResult error path
 * (missing key, SDK exception, empty response, content-policy refusal,
 * unparseable JSON) sets one of these via normalizeModelResult's
 * `errorCategory` option — see lib/vision/normalize.ts.
 */
export type ProviderErrorCategory =
  | "missing_api_key"
  | "timeout"
  | "auth"
  | "rate_limit"
  | "server_error"
  | "network"
  | "content_policy"
  | "empty_response"
  | "parse_failure"
  | "unknown";

export interface ProviderErrorInfo {
  category: ProviderErrorCategory;
  message: string;
}

/**
 * Turns SDK-specific error shapes into a consistent, user-facing Korean
 * reason *and* a structured category. OpenAI/Anthropic SDK errors expose
 * `.status`; the Gemini SDK throws plain Errors whose message embeds the
 * HTTP status, so we fall back to sniffing the message text for that case.
 */
export function classifyProviderError(error: unknown, providerLabel: string): ProviderErrorInfo {
  const status = extractStatus(error);
  const message = error instanceof Error ? error.message : String(error);

  if (isTimeout(error, message)) {
    return { category: "timeout", message: `${providerLabel} 응답 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.` };
  }
  if (status === 401 || status === 403) {
    return {
      category: "auth",
      message: `${providerLabel} API 키가 유효하지 않거나 권한이 없습니다. .env.local의 API 키를 확인해주세요.`,
    };
  }
  if (status === 429) {
    return {
      category: "rate_limit",
      message: `${providerLabel} API 사용량 한도(rate limit)에 도달했습니다. 잠시 후 다시 시도해주세요.`,
    };
  }
  if (status !== null && status >= 500) {
    return {
      category: "server_error",
      message: `${providerLabel} 서버에 일시적인 문제가 있습니다 (HTTP ${status}). 잠시 후 다시 시도해주세요.`,
    };
  }
  if (isNetworkError(message)) {
    return { category: "network", message: `${providerLabel}에 연결할 수 없습니다. 네트워크 상태를 확인해주세요.` };
  }

  return { category: "unknown", message: `${providerLabel} 호출 실패: ${message}` };
}

/** @deprecated kept for call sites that only need the message string — prefer classifyProviderError. */
export function describeProviderError(error: unknown, providerLabel: string): string {
  return classifyProviderError(error, providerLabel).message;
}

function extractStatus(error: unknown): number | null {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/\b(4\d{2}|5\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function isTimeout(error: unknown, message: string): boolean {
  if (error && typeof error === "object" && "name" in error) {
    const name = (error as { name?: unknown }).name;
    if (name === "AbortError" || name === "APIConnectionTimeoutError") return true;
  }
  return /timed? ?out|timeout|ETIMEDOUT/i.test(message);
}

function isNetworkError(message: string): boolean {
  return /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|network/i.test(message);
}
