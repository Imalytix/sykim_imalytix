import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/client";
import { getSignedImageUrl } from "@/lib/storage/imageStore";
import type { RequestContext } from "@/lib/net/requestContext";
import type { AnalysisResult, CachedFullResult, FinalResult, MetadataAnalysis, SuspiciousRegion, VisionResult } from "@/types/analysis";

/** Postgres bit(64) columns are set via their text input format — a 64-char
 *  string of '0'/'1' — since there's no bytea->bit cast to go through hex
 *  directly (see supabase/schema.sql for why). */
function hexToBitString(hex: string, bits = 64): string {
  return BigInt(`0x${hex}`).toString(2).padStart(bits, "0");
}

export interface SimilarImageMatch {
  request_id: string;
  distance: number;
  is_ai_generated: boolean | null;
  ai_probability: number | null;
  image_path: string | null;
  created_at: string;
  full_result: CachedFullResult | null;
}

/** RPC rows come back as (evidence, evidence_summary, suspicious_regions)
 *  columns (see schema.sql's find_similar_images JOIN) — reassembled here
 *  into the same CachedFullResult shape the rest
 *  of the app (aggregator.ts, pipeline.ts) already expects, so that code
 *  didn't need to change when the storage moved from a single full_result
 *  jsonb column to a normalized verification_evidence table. */
function toFullResult(row: {
  evidence: VisionResult[] | null;
  evidence_summary: string[] | null;
  suspicious_regions: SuspiciousRegion[] | null;
}): CachedFullResult | null {
  if (!row.evidence || row.evidence.length === 0) return null;
  return {
    vision_results: row.evidence,
    evidence_summary: row.evidence_summary ?? [],
    suspicious_regions: row.suspicious_regions ?? [],
  };
}

type RawMatchRow = {
  request_id: string;
  distance: number;
  is_ai_generated: boolean | null;
  ai_probability: number | null;
  image_path: string | null;
  created_at: string;
  evidence: VisionResult[] | null;
  evidence_summary: string[] | null;
  suspicious_regions: SuspiciousRegion[] | null;
};

/**
 * Hamming-distance search against previously analyzed images (see
 * supabase/schema.sql — find_similar_images RPC). Distance is out of 64 bits;
 * 0 = identical, ~1-5 = same image re-saved/re-compressed, ~6-10 = loosely similar.
 * Best-effort: returns [] (never throws) if Supabase isn't configured or the
 * query fails, so a DB hiccup never blocks an analysis request.
 */
export async function findSimilarImages(
  phashHex: string,
  options: { maxDistance?: number; limit?: number } = {},
): Promise<SimilarImageMatch[]> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];

  const { data, error } = await supabase.rpc("find_similar_images", {
    p_phash_bits: hexToBitString(phashHex),
    p_max_distance: options.maxDistance ?? 10,
    p_limit: options.limit ?? 20,
  });

  if (error) {
    console.error("[verification] find_similar_images failed", error);
    return [];
  }
  return ((data ?? []) as RawMatchRow[]).map((row) => ({
    request_id: row.request_id,
    distance: row.distance,
    is_ai_generated: row.is_ai_generated,
    ai_probability: row.ai_probability,
    image_path: row.image_path,
    created_at: row.created_at,
    full_result: toFullResult(row),
  }));
}

export interface RecordVerificationParams {
  requestId: string;
  userId: string | null;
  inputType: "file_upload" | "image_url";
  mode: string;
  status: "ok" | "error";
  errorMessage?: string | null;
  durationMs: number;
  context: RequestContext;
  sourceUrl?: string | null;
  filename?: string | null;
  /** Present only when an image was actually decoded/analyzed — absent for
   *  requests that failed validation before that point. */
  image?: {
    phashHex: string;
    width: number;
    height: number;
    mimeType: string;
    fileSizeBytes: number;
    imagePath: string | null;
  } | null;
  /** Every provider result (including failed/mock ones) — mirrors what
   *  AnalysisResult.vision_results already carries, unfiltered. Feeds
   *  verification_evidence (normalized, for display) always, and
   *  ai_provider_calls (raw cost/token log) only when loggedProviderCalls
   *  isn't false. */
  visionResults?: VisionResult[];
  /** Set to false on an exact-duplicate cache hit (lib/analysis/pipeline.ts's
   *  EXACT_DUPLICATE_PHASH_DISTANCE fast path) — visionResults there is the
   *  *reused* result from an earlier request, not a fresh call, so writing
   *  ai_provider_calls rows for it would misrepresent actual API spend in
   *  the cost/token audit table even though verification_evidence should
   *  still show the (reused) judgment. Defaults to true. */
  loggedProviderCalls?: boolean;
  metadataResult?: MetadataAnalysis | null;
  finalResult?: FinalResult | null;
  evidenceSummary?: string[];
  suspiciousRegions?: SuspiciousRegion[];
  limitations?: string[];
  recommendedAction?: string | null;
}

/**
 * Records one analysis request across verification_requests/request_images/
 * ai_provider_calls/verification_evidence/verification_results in a single
 * atomic RPC call (see supabase/schema.sql's record_verification — a
 * transaction, so a partial failure can't leave the tables half-filled the
 * way 5-10 separate round-trips could). Best-effort/non-throwing, same
 * posture as the rest of this pipeline: a DB hiccup must never fail the
 * analysis response itself.
 *
 * Called from two places: lib/analysis/pipeline.ts on a successful analysis
 * (full payload), and the API routes' catch blocks on a validation/
 * unexpected error (just the request-level fields — image/visionResults/etc.
 * omitted, matching what the old request_logs "error" rows recorded).
 */
export async function recordVerification(params: RecordVerificationParams): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    console.warn("[verification] Supabase가 설정되지 않아 기록하지 못했습니다", params.requestId);
    return;
  }

  const providerCalls = params.loggedProviderCalls === false ? [] : (params.visionResults ?? []).map((v) => ({
    provider: v.provider,
    model_name: v.model_name ?? null,
    prompt_type: null,
    status: v.error_message ? "error" : "ok",
    error_message: v.error_message ?? null,
    error_category: v.error_category ?? null,
    raw_response:
      typeof v.raw_response === "string" ? v.raw_response.slice(0, 2000) : v.raw_response ? JSON.stringify(v.raw_response).slice(0, 2000) : null,
    input_tokens: v.usage?.input_tokens ?? null,
    output_tokens: v.usage?.output_tokens ?? null,
    cost_usd: v.usage?.cost_usd ?? null,
    latency_ms: v.latency_ms ?? null,
  }));

  const evidence = [
    ...(params.metadataResult
      ? [
          {
            source: "metadata",
            score: params.metadataResult.metadata_score,
            confidence: null,
            is_ai_generated: null,
            result: params.metadataResult,
          },
        ]
      : []),
    ...(params.visionResults ?? []).map((v) => ({
      source: v.provider,
      score: v.score,
      confidence: v.confidence,
      is_ai_generated: v.is_ai_generated,
      result: v,
    })),
  ];

  const payload = {
    request: {
      request_id: params.requestId,
      user_id: params.userId,
      input_type: params.inputType,
      mode: params.mode,
      status: params.status,
      error_message: params.errorMessage ?? null,
      duration_ms: params.durationMs,
      ip: params.context.ip,
      user_agent: params.context.userAgent,
      origin: params.context.origin,
      referer: params.context.referer,
      source_url: params.sourceUrl ?? null,
      filename: params.filename ?? null,
    },
    image: params.image
      ? {
          phash_bits: hexToBitString(params.image.phashHex),
          width: params.image.width,
          height: params.image.height,
          mime_type: params.image.mimeType,
          file_size: params.image.fileSizeBytes,
          category: null,
          image_url: params.image.imagePath,
        }
      : null,
    provider_calls: providerCalls.length > 0 ? providerCalls : null,
    evidence: evidence.length > 0 ? evidence : null,
    result: params.finalResult
      ? {
          final_score: params.finalResult.ai_probability,
          final_label: params.finalResult.label,
          is_ai_generated: params.finalResult.is_ai_generated,
          confidence: params.finalResult.confidence,
          evidence_summary: params.evidenceSummary ?? [],
          suspicious_regions: params.suspiciousRegions ?? [],
          limitations: params.limitations ?? [],
          recommended_action: params.recommendedAction ?? null,
        }
      : null,
  };

  const { error } = await supabase.rpc("record_verification", { payload });
  if (error) {
    console.error("[verification] record_verification failed", params.requestId, error);
  }
}

/**
 * Reconstructs a past analysis as a full `AnalysisResult` for a "내 분석
 * 이력" detail view (app/history/[requestId]) — the mirror-image operation
 * of recordVerification's write side.
 *
 * Takes the *caller's session-bound* Supabase client (from
 * lib/supabase/serverClient.ts), not the service_role admin client — every
 * query below runs under that user's RLS policies (`auth.uid() = user_id`,
 * see schema.sql), so a request_id belonging to another user simply comes
 * back empty here and this returns null. That's the actual ownership check;
 * there's no separate manual `user_id === requestingUser` comparison because
 * the database itself won't return the row otherwise. This is deliberately
 * a different code path from findSimilarImages/findSimilarByEmbedding above,
 * which use the admin client on purpose — cross-user phash/embedding
 * duplicate-detection during analysis is supposed to see every user's
 * images, only this user-facing history view needs to be scoped.
 *
 * duplicate_check is filled with a neutral "not checked" value — it isn't
 * stored per-request, and re-deriving it would require re-running the
 * duplicate search against the current DB state, which could legitimately
 * disagree with what happened at analysis time.
 */
export async function getVerificationDetail(
  supabase: SupabaseClient,
  requestId: string,
): Promise<{ analysisResult: AnalysisResult; imageUrl: string | null } | null> {
  const { data: request } = await supabase
    .from("verification_requests")
    .select("id, request_id, mode, input_type")
    .eq("request_id", requestId)
    .maybeSingle();
  if (!request) return null;

  const [{ data: image }, { data: evidenceRows }, { data: result }] = await Promise.all([
    supabase.from("request_images").select("width, height, mime_type, image_url").eq("request_id", request.id).maybeSingle(),
    supabase.from("verification_evidence").select("source, result").eq("request_id", request.id),
    supabase
      .from("verification_results")
      .select("final_score, final_label, is_ai_generated, confidence, evidence_summary, suspicious_regions, limitations, recommended_action")
      .eq("request_id", request.id)
      .maybeSingle(),
  ]);

  const metadataRow = (evidenceRows ?? []).find((e) => e.source === "metadata");
  const visionResults = (evidenceRows ?? [])
    .filter((e) => e.source !== "metadata")
    .map((e) => e.result as VisionResult);

  const imageUrl = image ? await getSignedImageUrl(image.image_url) : null;

  const analysisResult: AnalysisResult = {
    product: "Imalytix",
    request_id: request.request_id,
    mode: request.mode as AnalysisResult["mode"],
    input: {
      type: request.input_type,
      mime_type: image?.mime_type ?? "",
      width: image?.width ?? 0,
      height: image?.height ?? 0,
      phash: "",
    },
    analyzed_image_data_url: imageUrl ?? "",
    final_result: {
      is_ai_generated: result?.is_ai_generated ?? null,
      ai_probability: result?.final_score ?? 0,
      label: result?.final_label ?? "판정 불가",
      confidence: (result?.confidence as FinalResult["confidence"]) ?? "low",
    },
    metadata_analysis:
      (metadataRow?.result as MetadataAnalysis) ?? {
        exif_found: false,
        png_metadata_found: false,
        c2pa_found: false,
        ai_tool_detected: false,
        detected_tools: [],
        metadata_score: 0,
        camera_make_model_found: false,
        evidence: [],
        limitations: [],
        raw: {},
        camera_info: null,
        file_info: { format: image?.mime_type ?? null, width: image?.width ?? 0, height: image?.height ?? 0, size_bytes: 0, color_space: null },
      },
    vision_results: visionResults,
    evidence_summary: (result?.evidence_summary as string[]) ?? [],
    suspicious_regions: (result?.suspicious_regions as SuspiciousRegion[]) ?? [],
    limitations: (result?.limitations as string[]) ?? [],
    recommended_action: result?.recommended_action ?? "",
    duplicate_check: { checked: false, matches: [], used_cached_result: false, influenced_score: false },
  };

  return { analysisResult, imageUrl };
}
