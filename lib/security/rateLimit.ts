/**
 * Per-IP fixed-window rate limiter for the analyze endpoints — there is no
 * login/API-key system (per project scope), so an IP-based cap is the only
 * lever available to stop one caller from burning through the OpenAI/
 * Gemini/Anthropic token budget via scripted bulk requests.
 *
 * Deliberately in-memory (a plain Map), not Supabase/Redis-backed: it only
 * needs to survive within one running process. Known limitations, both
 * acceptable for this project's current single-instance deployment but
 * worth revisiting if that changes:
 *   - Resets on every process restart/deploy.
 *   - Not shared across instances — horizontally scaling (multiple `next
 *     start` processes, or serverless functions) gives each instance its
 *     own independent budget, so the *effective* per-IP ceiling multiplies
 *     by instance count. A shared store (Supabase table with an atomic
 *     increment, or Upstash Redis) would be needed to close that gap.
 *   - Keyed off X-Forwarded-For (see extractRequestContext in
 *     lib/net/requestContext.ts), which is only trustworthy behind a reverse proxy
 *     that sets it (Vercel does this automatically). Self-hosting `next
 *     start` directly with no proxy in front means every caller's IP reads
 *     as null and collapses into one shared "unknown" bucket — effectively
 *     no per-caller isolation. Put a reverse proxy (nginx, Vercel, etc. )
 *     in front for this to do anything in production.
 */

interface Bucket {
  count: number;
  windowStart: number;
}

const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MINUTES || 10) * 60_000;
const MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX_REQUESTS || 20);

const buckets = new Map<string, Bucket>();

// Cheap unbounded-growth guard: a Map entry per distinct IP that ever hit
// this process never gets removed otherwise. Sweeping is triggered by size
// rather than a timer so an idle process doesn't run background work.
function sweepExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart > WINDOW_MS) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export function checkRateLimit(ip: string | null): RateLimitResult {
  const key = ip ?? "unknown";
  const now = Date.now();

  if (buckets.size > 5000) sweepExpired(now);

  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true };
  }

  if (bucket.count >= MAX_REQUESTS) {
    return { allowed: false, retryAfterSeconds: Math.ceil((WINDOW_MS - (now - bucket.windowStart)) / 1000) };
  }

  bucket.count += 1;
  return { allowed: true };
}
