import { getSupabaseAdmin } from "@/lib/supabase/client";
import type { CachedFullResult } from "@/types/analysis";

/** Postgres bit(64) columns are set via their text input format — a 64-char
 *  string of '0'/'1' — since there's no bytea->bit cast to go through hex
 *  directly (see supabase/schema.sql for why). */
function hexToBitString(hex: string, bits = 64): string {
  return BigInt(`0x${hex}`).toString(2).padStart(bits, "0");
}

/** pgvector's text input format for a `vector(N)` column/param is a plain
 *  `[v1,v2,...]` literal — no separate encoding needed, supabase-js just
 *  ships this as the RPC argument and Postgres casts it against the
 *  function's declared `vector(384)` parameter type. */
function embeddingToVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export interface SimilarImageMatch {
  request_id: string;
  distance: number;
  is_ai_generated: boolean | null;
  ai_probability: number | null;
  image_path: string | null;
  created_at: string;
  /** Which search found this match — phash (near-exact re-upload/re-
   *  compression) or embedding (semantically similar per DINOv3, only run
   *  when phash found nothing). See findSimilarImagesTwoStage. */
  match_type: "phash" | "embedding";
  /** null for pre-migration rows — see types/analysis.ts's CachedFullResult. */
  full_result: CachedFullResult | null;
}

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
    console.error("[imageRecords] find_similar_images failed", error);
    return [];
  }
  return ((data ?? []) as Omit<SimilarImageMatch, "match_type">[]).map((row) => ({ ...row, match_type: "phash" as const }));
}

/**
 * Cosine-distance kNN search against DINOv3 embeddings (see supabase/schema.sql
 * — find_similar_by_embedding RPC + the images_embedding_hnsw_idx HNSW index).
 * Distance is 0 (identical direction) to 2 (opposite); p_max_distance defaults
 * to a conservative 0.15 (see schema.sql comment on why). Best-effort like
 * findSimilarImages — [] on any failure, never throws.
 */
export async function findSimilarByEmbedding(
  embedding: number[],
  options: { maxDistance?: number; limit?: number } = {},
): Promise<SimilarImageMatch[]> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];

  const { data, error } = await supabase.rpc("find_similar_by_embedding", {
    p_embedding: embeddingToVectorLiteral(embedding),
    p_max_distance: options.maxDistance ?? 0.15,
    p_limit: options.limit ?? 20,
  });

  if (error) {
    console.error("[imageRecords] find_similar_by_embedding failed", error);
    return [];
  }
  return ((data ?? []) as Omit<SimilarImageMatch, "match_type">[]).map((row) => ({ ...row, match_type: "embedding" as const }));
}

/**
 * Records this analysis so future requests can be compared against it.
 * Best-effort/fire-and-forget semantics — a failed insert must never fail
 * the analysis response (same posture as saveAnalyzedImage/logAnalysisEvent).
 */
export async function insertImageRecord(params: {
  requestId: string;
  phashHex: string;
  category?: string | null;
  isAiGenerated: boolean | null;
  aiProbability: number;
  imagePath: string | null;
  mode: string;
  /** DINOv3 embedding for this image, or null when DINO was off/unreachable
   *  for this request — stored as NULL, excluded from kNN search automatically. */
  embedding?: number[] | null;
  /** vision_results/evidence_summary/suspicious_regions to store alongside
   *  this row — see types/analysis.ts's CachedFullResult. pipeline.ts always
   *  passes one (propagating the matched row's own full_result forward on a
   *  cache hit, so it's never lost across a chain of re-uploads). */
  fullResult?: CachedFullResult | null;
}): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;

  const { error } = await supabase.rpc("insert_image_record", {
    p_request_id: params.requestId,
    p_phash_bits: hexToBitString(params.phashHex),
    p_category: params.category ?? null,
    p_is_ai_generated: params.isAiGenerated,
    p_ai_probability: params.aiProbability,
    p_image_path: params.imagePath,
    p_mode: params.mode,
    p_embedding: params.embedding ? embeddingToVectorLiteral(params.embedding) : null,
    p_full_result: params.fullResult ?? null,
  });

  if (error) {
    console.error("[imageRecords] insert_image_record failed", error);
  }
}
