import { createBrowserClient } from "@supabase/ssr";

/**
 * Client Component-side Supabase client — uses the public anon key (safe to
 * ship to the browser; access is scoped by RLS, unlike the service_role
 * client in lib/supabase/client.ts which must never leave the server).
 *
 * A fresh instance per call is intentional (matches @supabase/ssr's own
 * examples) — it's cheap, and avoids subtle bugs from a stale singleton
 * outliving a session change (sign-in/sign-out) in the same tab.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
