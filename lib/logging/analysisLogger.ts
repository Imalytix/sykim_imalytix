import type { NextRequest } from "next/server";
import type { AnalysisResult } from "@/types/analysis";
import { getSupabaseAdmin } from "@/lib/supabase/client";

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
 *  the connecting IP, so a reverse proxy (Vercel, nginx with
 *  `$proxy_add_x_forwarded_for`, etc.) appends the real client IP as the
 *  LAST entry, while everything before that is whatever the client itself
 *  claimed. Taking the first entry (a bug fixed here — this project's rate
 *  limiter, lib/security/rateLimit.ts, keys on this same value) lets any
 *  caller spoof a fresh IP on every request just by setting the header
 *  themselves, fully defeating both the per-IP rate limit and the ip field
 *  in this log. Taking the last entry instead trusts only what the nearest
 *  proxy hop itself observed, which the client cannot override — but this
 *  still assumes there IS a reverse proxy in front terminating the real
 *  connection; with no proxy at all, this header doesn't exist or isn't
 *  trustworthy either way (see rateLimit.ts's "unknown" bucket fallback). */
export function extractRequestContext(request: NextRequest): RequestContext {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const chain = forwardedFor?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  return {
    ip: chain.length > 0 ? chain[chain.length - 1] : request.headers.get("x-real-ip") || null,
    userAgent: request.headers.get("user-agent"),
    origin: request.headers.get("origin"),
    referer: request.headers.get("referer"),
  };
}

interface AnalysisLogEntrySuccess {
  status: "ok";
  requestId: string;
  durationMs: number;
  context: RequestContext;
  inputType: "file_upload" | "image_url";
  mode: string;
  sourceUrl?: string | null;
  filename?: string | null;
  imagePath: string | null;
  result: AnalysisResult;
}

interface AnalysisLogEntryError {
  status: "error";
  requestId: string;
  durationMs: number;
  context: RequestContext;
  inputType: "file_upload" | "image_url";
  mode: string;
  sourceUrl?: string | null;
  filename?: string | null;
  errorMessage: string;
}

export type AnalysisLogEntry = AnalysisLogEntrySuccess | AnalysisLogEntryError;

/** Record shape written to Supabase `request_logs` — a single builder so
 *  there's one definition of "what a log entry looks like" even though it's
 *  only got one sink now (see logAnalysisEvent). */
function buildLogRecord(entry: AnalysisLogEntry): Record<string, unknown> {
  const base = {
    request_timestamp: new Date().toISOString(),
    request_id: entry.requestId,
    status: entry.status,
    duration_ms: entry.durationMs,
    ip: entry.context.ip,
    user_agent: entry.context.userAgent,
    origin: entry.context.origin,
    referer: entry.context.referer,
    input_type: entry.inputType,
    mode: entry.mode,
    source_url: entry.sourceUrl ?? null,
    filename: entry.filename ?? null,
  };

  if (entry.status === "ok") {
    return {
      ...base,
      image_path: entry.imagePath,
      phash: entry.result.input.phash,
      final_result: entry.result.final_result,
      providers: entry.result.vision_results.map((v) => ({
        provider: v.provider,
        score: v.score,
        confidence: v.confidence,
        is_ai_generated: v.is_ai_generated,
        error_message: v.error_message ?? null,
        // Machine-checkable failure reason (auth/rate_limit/timeout/
        // content_policy/...) — see lib/vision/errorMessage.ts. Lets this
        // be filtered/grouped on without parsing error_message's Korean
        // prose, e.g. `providers @> '[{"error_category":"rate_limit"}]'`
        // against the request_logs.providers jsonb column in Supabase.
        error_category: v.error_category ?? null,
        latency_ms: v.latency_ms ?? null,
        // Rough USD estimate (lib/vision/pricing.ts) — not billing-accurate,
        // see that file's caveat. Stored alongside raw token counts so a
        // stale price table can be corrected retroactively with a SQL
        // UPDATE against providers->>'usage' without re-running requests.
        usage: v.usage ?? null,
        // Kept even on "success" — a provider can return 200 with a
        // parse-failure fallback (score 0.5, no error_message) that's
        // only visible via limitations. Truncated raw_response gives
        // enough to diagnose provider-side refusals/oddities without
        // needing to reproduce them by hand.
        limitations: v.limitations,
        raw_response_excerpt:
          typeof v.raw_response === "string"
            ? v.raw_response.slice(0, 300)
            : v.raw_response
              ? JSON.stringify(v.raw_response).slice(0, 300)
              : null,
      })),
      metadata_score: entry.result.metadata_analysis.metadata_score,
    };
  }

  return { ...base, error_message: entry.errorMessage };
}

/** See supabase/schema.sql's `request_logs` table for the schema this
 *  writes into. No-ops (doesn't throw) when Supabase isn't configured —
 *  callers should be aware that means this request simply isn't logged
 *  anywhere, not that it silently falls back to a local file. */
async function writeSupabaseLog(record: Record<string, unknown>): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    console.warn("[analysisLogger] Supabase가 설정되지 않아 로그를 저장하지 못했습니다", record.request_id);
    return;
  }
  try {
    const { error } = await supabase.from("request_logs").insert(record);
    if (error) throw error;
  } catch (error) {
    console.error("[analysisLogger] Supabase 로그 저장 실패", record.request_id, error);
  }
}

/**
 * Records one analysis request for manual review (who requested, when, from
 * where, what image, what result/errors) to Supabase `request_logs` —
 * Supabase-only, no local JSON-Lines fallback (this project's log store of
 * record is Supabase; a local copy would just be a second thing to keep in
 * sync, and it wouldn't survive Vercel's wiped-between-invocations
 * filesystem anyway). Best-effort/non-throwing: a logging failure must
 * never surface as an analysis failure.
 */
export async function logAnalysisEvent(entry: AnalysisLogEntry): Promise<void> {
  const record = buildLogRecord(entry);
  await writeSupabaseLog(record);
}
