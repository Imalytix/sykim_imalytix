import type { NextRequest } from "next/server";

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
  origin: string | null;
  referer: string | null;
}

/** Best-effort extraction — these headers are only trustworthy behind a
 *  reverse proxy that sets them (Vercel does); for a bare `next start` with
 *  nothing in front, they're absent or fully attacker-controlled.
 *
 *  x-forwarded-for is read as a *chain*: each hop prepends its own view of
 *  the connecting IP, so a reverse proxy appends the real client IP as the
 *  LAST entry, while everything before that is whatever the client itself
 *  claimed. Taking the first entry would let any caller spoof a fresh IP on
 *  every request (this project's rate limiter, lib/security/rateLimit.ts,
 *  keys on this same value) — taking the last entry instead trusts only
 *  what the nearest proxy hop itself observed, which the client cannot
 *  override. Still assumes there IS a reverse proxy in front terminating
 *  the real connection; with no proxy at all this header isn't trustworthy
 *  either way (see rateLimit.ts's "unknown" bucket fallback). */
export function extractRequestContext(request: NextRequest): RequestContext {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const chain = forwardedFor
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) ?? [];
  return {
    ip: chain.length > 0 ? chain[chain.length - 1] : request.headers.get("x-real-ip") || null,
    userAgent: request.headers.get("user-agent"),
    origin: request.headers.get("origin"),
    referer: request.headers.get("referer"),
  };
}
