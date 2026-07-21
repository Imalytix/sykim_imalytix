import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const STORAGE_ROOT = path.join(process.cwd(), "storage");
const UPLOADS_DIR = path.join(STORAGE_ROOT, "uploads");

function todayFolder(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Persists the normalized image that was actually analyzed, keyed by request_id.
 *
 * Local-disk only: on Vercel/serverless this directory is ephemeral (wiped
 * between invocations), so this is intentionally scoped to local/self-hosted
 * execution. Swap this module for an object-storage client (S3/R2/Vercel
 * Blob) before deploying to a serverless target — `saveAnalyzedImage`'s
 * signature is the seam to swap behind.
 *
 * Returns the path relative to the project root (stable, log-friendly),
 * or null if the write failed — callers should treat storage as best-effort
 * and never fail analysis because a save didn't work.
 */
export async function saveAnalyzedImage(requestId: string, buffer: Buffer): Promise<string | null> {
  try {
    const dayDir = path.join(UPLOADS_DIR, todayFolder());
    await mkdir(dayDir, { recursive: true });
    const filePath = path.join(dayDir, `${requestId}.jpg`);
    await writeFile(filePath, buffer);
    return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
  } catch (error) {
    console.error("[imageStore] failed to save analyzed image", requestId, error);
    return null;
  }
}
