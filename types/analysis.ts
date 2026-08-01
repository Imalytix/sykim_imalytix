export type Confidence = "low" | "medium" | "high";
export type Severity = "low" | "medium" | "high";

export interface BBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Evidence {
  type: string;
  label: string;
  severity: Severity;
  description: string;
}

export interface SuspiciousRegion {
  label: string;
  severity: Severity;
  description: string;
  bbox?: BBox | null;
}

export type ContentType = "face" | "body" | "animal" | "landscape" | "object" | "text" | "other";

/** Token usage + a rough USD cost estimate for one provider call. `cost_usd`
 *  is computed client-side from a hardcoded per-model price table (see
 *  lib/vision/pricing.ts) — an estimate for relative cost tracking, not a
 *  substitute for the provider's actual billing dashboard. null for DINO
 *  (self-hosted, no per-token pricing) and whenever a provider's response
 *  didn't include usage data. */
export interface UsageInfo {
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
}

export interface VisionResult {
  provider: "openai" | "gemini" | "claude" | "dino";
  model_name?: string;
  is_ai_generated: boolean | null;
  score: number;
  confidence: Confidence;
  content_type?: ContentType | null;
  evidence: Evidence[];
  suspicious_regions: SuspiciousRegion[];
  limitations: string[];
  raw_response?: unknown;
  is_mock?: boolean;
  error_message?: string | null;
  /** Machine-checkable failure reason — see lib/vision/errorMessage.ts's
   *  ProviderErrorCategory for the full set. null on success. */
  error_category?: string | null;
  /** Wall-clock time for this provider's call(s), including any internal
   *  retries (e.g. OpenAI's refusal-retry loop) — measured around the
   *  network call(s) only, not prompt-building/image-encoding. null when
   *  the call never reached the network (e.g. missing API key). */
  latency_ms?: number | null;
  usage?: UsageInfo | null;
}

/** Camera/capture fields pulled from EXIF, for display only — never used as
 *  scoring input beyond the existing make/model/lens presence check in
 *  metadata.ts (values are trivially editable, so no *new* signal here, just
 *  surfacing what's already read). `null` fields mean "not present in this
 *  image's EXIF", not "unknown" — a re-compressed/screenshotted photo
 *  legitimately has none of these. GPS coordinates are deliberately not
 *  exposed, only whether they're present — this app has no reason to handle
 *  a user's/subject's raw location data. */
export interface CameraInfo {
  make: string | null;
  model: string | null;
  lens_model: string | null;
  /** ISO 8601, from EXIF DateTimeOriginal/CreateDate. */
  captured_at: string | null;
  /** Formatted for display, e.g. "1/120s". */
  exposure_time: string | null;
  /** Formatted for display, e.g. "ƒ1.8". */
  f_number: string | null;
  iso: number | null;
  has_gps: boolean;
}

export interface FileInfo {
  format: string | null;
  width: number;
  height: number;
  size_bytes: number;
  /** sharp's raw color-space tag (e.g. "srgb") — not a full ICC profile
   *  name, so this won't say "Display P3" even when the file embeds that
   *  profile; it's the closest sharp exposes without deeper ICC parsing. */
  color_space: string | null;
}

export interface MetadataAnalysis {
  exif_found: boolean;
  png_metadata_found: boolean;
  c2pa_found: boolean;
  ai_tool_detected: boolean;
  detected_tools: string[];
  metadata_score: number;
  camera_make_model_found: boolean;
  evidence: string[];
  limitations: string[];
  raw: Record<string, unknown>;
  /** null when no camera/capture EXIF fields were found at all. */
  camera_info: CameraInfo | null;
  file_info: FileInfo;
}

export interface FinalResult {
  is_ai_generated: boolean | null;
  ai_probability: number;
  label: string;
  confidence: Confidence;
}

export interface AnalysisInput {
  type: string;
  mime_type: string;
  width: number;
  height: number;
  phash: string;
}

/** The parts of a past AnalysisResult that came from actually running the
 *  vision models — stored on `images.full_result` so a future exact-
 *  duplicate hit can display a genuinely complete result instead of just
 *  the bare final score. See aggregator.ts's buildDuplicateAggregateResult. */
export interface CachedFullResult {
  vision_results: VisionResult[];
  evidence_summary: string[];
  suspicious_regions: SuspiciousRegion[];
}

export interface SimilarImageMatch {
  request_id: string;
  distance: number;
  is_ai_generated: boolean | null;
  ai_probability: number | null;
  image_path: string | null;
  created_at: string;
  /** "phash" = near-exact re-upload/re-compression match; "embedding" =
   *  DINOv3 kNN fallback, only run when pHash found nothing. */
  match_type: "phash" | "embedding";
  /** null for rows inserted before this column existed, or when the matched
   *  row was itself a duplicate-of-a-duplicate whose original also predates
   *  it. pipeline.ts only takes the exact-duplicate fast path when this is
   *  present — see EXACT_DUPLICATE_PHASH_DISTANCE there. */
  full_result: CachedFullResult | null;
}

export interface DuplicateCheck {
  /** false when Supabase isn't configured — matches will always be []. */
  checked: boolean;
  matches: SimilarImageMatch[];
  /** true when a near-identical pHash match short-circuited this request —
   *  the LLM/DINO calls were skipped entirely and final_result reuses that
   *  earlier image's stored verdict (see aggregator.ts's
   *  buildDuplicateAggregateResult). matches[0] is that image. */
  used_cached_result: boolean;
  /** true when non-exact similar matches (pHash-loose or DINOv3-embedding)
   *  nudged final_result.ai_probability via aggregator.ts's similar-image
   *  bonus/penalty, without skipping analysis. matches[0] is the closest one
   *  that was actually used. */
  influenced_score: boolean;
}

export interface AnalysisResult {
  product: string;
  request_id: string;
  mode: "quick" | "standard" | "deep";
  input: AnalysisInput;
  /** data: URL of the exact normalized JPEG bytes that were analyzed (post
   *  EXIF-rotate/flatten/resize) — always show this, never the originally
   *  uploaded/fetched bytes, so the preview matches what the models saw. */
  analyzed_image_data_url: string;
  final_result: FinalResult;
  metadata_analysis: MetadataAnalysis;
  vision_results: VisionResult[];
  evidence_summary: string[];
  suspicious_regions: SuspiciousRegion[];
  limitations: string[];
  recommended_action: string;
  duplicate_check: DuplicateCheck;
}

export interface HealthResponse {
  status: "ok";
  models: {
    openai: boolean;
    gemini: boolean;
    anthropic: boolean;
  };
}
