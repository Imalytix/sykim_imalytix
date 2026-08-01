import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/client";

const BUCKET_NAME = "analyzed-images";

function todayFolder(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// Buckets are created once per server lifetime, not checked on every upload —
// storage.getBucket()/createBucket() are extra network round-trips we don't
// want to pay for on every single analysis request.
let bucketEnsured = false;

async function ensureBucket(supabase: SupabaseClient): Promise<void> {
  if (bucketEnsured) return;
  const { data: existing } = await supabase.storage.getBucket(BUCKET_NAME);
  if (!existing) {
    const { error } = await supabase.storage.createBucket(BUCKET_NAME, {
      public: false,
      fileSizeLimit: "10MB",
    });
    // A concurrent request may have created it between our getBucket() and
    // createBucket() calls — that's not a real failure, just a race we lost.
    if (error && !error.message.toLowerCase().includes("already exists")) {
      throw error;
    }
  }
  bucketEnsured = true;
}

async function saveToSupabase(requestId: string, buffer: Buffer): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;

  try {
    await ensureBucket(supabase);
    const objectPath = `${todayFolder()}/${requestId}.jpg`;
    const { error } = await supabase.storage.from(BUCKET_NAME).upload(objectPath, buffer, {
      contentType: "image/jpeg",
      upsert: true,
    });
    if (error) throw error;
    // Not a public URL (bucket is private) — just a stable pointer for logs/DB.
    // Fetching the actual bytes back later requires a signed URL, generated
    // on demand via supabase.storage.from(BUCKET_NAME).createSignedUrl(...).
    return `supabase://${BUCKET_NAME}/${objectPath}`;
  } catch (error) {
    console.error("[imageStore] Supabase Storage 업로드 실패", requestId, error);
    return null;
  }
}

/**
 * Persists the normalized image that was actually analyzed, keyed by
 * request_id — Supabase Storage only (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * required). No local-disk fallback: this project's storage of record is
 * Supabase, and a local `storage/uploads/` copy would just be a second thing
 * to keep in sync (and still wouldn't survive Vercel's wiped-between-
 * invocations filesystem anyway). If Supabase isn't configured or the
 * upload fails, this returns null — best-effort, same posture as the rest
 * of this pipeline: a storage miss must never fail the analysis itself.
 */
export async function saveAnalyzedImage(requestId: string, buffer: Buffer): Promise<string | null> {
  return saveToSupabase(requestId, buffer);
}

const STORAGE_URL_PREFIX = `supabase://${BUCKET_NAME}/`;

/** Strips the `supabase://analyzed-images/` prefix saveToSupabase() adds,
 *  back down to the raw object path createSignedUrl() expects. null for
 *  anything that isn't one of our own storage paths (e.g. legacy rows, or
 *  null image_url). */
function toObjectPath(imageUrl: string | null): string | null {
  if (!imageUrl || !imageUrl.startsWith(STORAGE_URL_PREFIX)) return null;
  return imageUrl.slice(STORAGE_URL_PREFIX.length);
}

/**
 * Generates a time-limited signed URL for a private bucket object — the
 * bucket has no public/anon read access (created with `public: false`, no
 * storage RLS policies), so this is the only way to render a thumbnail.
 * Callers are responsible for having already verified the requesting user
 * owns the underlying request (see app/history's DB-layer ownership checks)
 * *before* calling this — the signed URL itself grants access to anyone
 * holding it for its lifetime, so it must not be minted for images the
 * caller hasn't confirmed belong to the current user.
 */
export async function getSignedImageUrl(imageUrl: string | null, expiresInSeconds = 3600): Promise<string | null> {
  const objectPath = toObjectPath(imageUrl);
  const supabase = getSupabaseAdmin();
  if (!objectPath || !supabase) return null;

  const { data, error } = await supabase.storage.from(BUCKET_NAME).createSignedUrl(objectPath, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}

/**
 * Batch variant for list views (e.g. /history) — one Storage API round-trip
 * for up to N paths instead of N round-trips. Returns a Map keyed by the
 * *original* image_url (not the stripped object path) so callers can look
 * results up directly against their source rows.
 */
export async function getSignedImageUrls(imageUrls: (string | null)[], expiresInSeconds = 3600): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const supabase = getSupabaseAdmin();
  if (!supabase) return result;

  const pathToOriginal = new Map<string, string>();
  for (const url of imageUrls) {
    const path = toObjectPath(url);
    if (path && url) pathToOriginal.set(path, url);
  }
  if (pathToOriginal.size === 0) return result;

  const { data, error } = await supabase.storage.from(BUCKET_NAME).createSignedUrls(Array.from(pathToOriginal.keys()), expiresInSeconds);
  if (error || !data) return result;

  for (const item of data) {
    const original = pathToOriginal.get(item.path ?? "");
    if (original && item.signedUrl) result.set(original, item.signedUrl);
  }
  return result;
}
