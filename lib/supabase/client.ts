import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/**
 * Server-only client using the service_role key (bypasses RLS). Never import
 * this from client components — the service_role key must not reach the browser.
 * Returns null when Supabase isn't configured yet, so callers can no-op instead
 * of crashing (DB features are best-effort, same posture as imageStore/logging).
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  if (!cached) {
    cached = createClient(url, serviceKey, {
      auth: { persistSession: false },
      // Next.js's App Router patches the global fetch() for its Data Cache
      // (request dedup/caching), and that patched fetch does not reliably
      // pass a raw Buffer body through unchanged in a production build —
      // confirmed live: uploading the same file to Storage produced a byte-
      // for-byte-valid JPEG under `next dev` but a corrupted, non-JPEG blob
      // (UTF-8 replacement-character bytes, i.e. the body got routed through
      // a text decode somewhere) when hit on the deployed Vercel build.
      // `cache: "no-store"` opts this client's requests out of that patched
      // fetch's caching path entirely, which is also just correct: an image
      // upload response should never be cached anyway.
      global: {
        fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
      },
    });
  }
  return cached;
}
