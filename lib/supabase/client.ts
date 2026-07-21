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
    });
  }
  return cached;
}
