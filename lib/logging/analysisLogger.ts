import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import type { AnalysisResult } from "@/types/analysis";
import { getSupabaseAdmin } from "@/lib/supabase/client";

const LOGS_DIR = path.join(process.cwd(), "storage", "logs");

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
  origin: string | null;
  referer: string | null;
}

/** Best-effort extraction — these headers are only trustworthy behind a
 *  reverse proxy that sets them (Vercel does); for a bare `next start`
 *  they may be absent or spoofable. Good enough for local review logging. */
export function extractRequestContext(request: NextRequest): RequestContext {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return {
    ip: forwardedFor?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null,
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

function logFilePath(): string {
  const day = new Date().toISOString().slice(0, 10);
  return path.join(LOGS_DIR, `analysis-${day}.jsonl`);
}

/** Shared record shape written to both sinks (local JSONL + Supabase
 *  `request_logs`) — built once so the two writers can't drift apart. */
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

async function writeLocalLog(record: Record<string, unknown>): Promise<void> {
  try {
    await mkdir(LOGS_DIR, { recursive: true });
    await appendFile(logFilePath(), `${JSON.stringify(record)}\n`, "utf-8");
  } catch (error) {
    console.error("[analysisLogger] 로컬 로그 저장 실패", record.request_id, error);
  }
}

/** Vercel wipes the local filesystem between invocations, so this is the
 *  sink that actually survives in production — see supabase/schema.sql's
 *  `request_logs` table for the schema this writes into. */
async function writeSupabaseLog(record: Record<string, unknown>): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;
  try {
    const { error } = await supabase.from("request_logs").insert(record);
    if (error) throw error;
  } catch (error) {
    console.error("[analysisLogger] Supabase 로그 저장 실패", record.request_id, error);
  }
}

/**
 * Records one analysis request for manual review (who requested, when, from
 * where, what image, what result/errors) — to both a local JSON-Lines file
 * (fast, free, survives only on a persistently-running server) and Supabase
 * (survives on Vercel). Both writers are best-effort/non-throwing: a logging
 * failure must never surface as an analysis failure.
 */
export async function logAnalysisEvent(entry: AnalysisLogEntry): Promise<void> {
  const record = buildLogRecord(entry);
  await Promise.all([writeLocalLog(record), writeSupabaseLog(record)]);
}
