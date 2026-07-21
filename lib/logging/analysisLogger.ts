import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import type { AnalysisResult } from "@/types/analysis";

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

/**
 * Appends one JSON-Lines record per analysis request for manual review
 * (who requested, when, from where, what image, what result/errors).
 *
 * Deliberately a flat local file rather than a DB — this is the interim
 * "local execution" logging story; Phase 6 (Turso) supersedes it with
 * something queryable.
 */
export async function logAnalysisEvent(entry: AnalysisLogEntry): Promise<void> {
  try {
    await mkdir(LOGS_DIR, { recursive: true });

    const record =
      entry.status === "ok"
        ? {
            timestamp: new Date().toISOString(),
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
          }
        : {
            timestamp: new Date().toISOString(),
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
            error_message: entry.errorMessage,
          };

    await appendFile(logFilePath(), `${JSON.stringify(record)}\n`, "utf-8");
  } catch (error) {
    console.error("[analysisLogger] failed to write log entry", entry.requestId, error);
  }
}
