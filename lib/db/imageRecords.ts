import { getSupabaseAdmin } from "@/lib/supabase/client";

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
  return (data ?? []) as SimilarImageMatch[];
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
  });

  if (error) {
    console.error("[imageRecords] insert_image_record failed", error);
  }
}
