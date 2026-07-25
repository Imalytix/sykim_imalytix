import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/client";

const STORAGE_ROOT = path.join(process.cwd(), "storage");
const UPLOADS_DIR = path.join(STORAGE_ROOT, "uploads");
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

async function saveToLocalDisk(requestId: string, buffer: Buffer): Promise<string | null> {
  try {
    const dayDir = path.join(UPLOADS_DIR, todayFolder());
    await mkdir(dayDir, { recursive: true });
    const filePath = path.join(dayDir, `${requestId}.jpg`);
    await writeFile(filePath, buffer);
    return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
  } catch (error) {
    console.error("[imageStore] 로컬 디스크 저장 실패", requestId, error);
    return null;
  }
}

/**
 * Persists the normalized image that was actually analyzed, keyed by request_id.
 *
 * Supabase Storage is the primary target when configured (SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY) — this is what makes the image survive on
 * Vercel, where the local filesystem is wiped between invocations. Local
 * disk is only a fallback for running without Supabase configured at all
 * (e.g. a fresh clone before `supabase/schema.sql` / bucket setup is done).
 *
 * Returns a storage-agnostic path string (either `supabase://bucket/key` or
 * a project-relative local path) — callers should treat storage as
 * best-effort and never fail analysis because a save didn't work (both
 * paths return null on failure rather than throwing).
 */
export async function saveAnalyzedImage(requestId: string, buffer: Buffer): Promise<string | null> {
  const supabasePath = await saveToSupabase(requestId, buffer);
  if (supabasePath) return supabasePath;
  return saveToLocalDisk(requestId, buffer);
}
