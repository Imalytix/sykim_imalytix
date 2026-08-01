import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server Component / Route Handler-side Supabase client — reads/writes the
 * session via Next.js's cookie jar so `supabase.auth.getUser()` reflects
 * whoever's actually logged in for *this* request, not a server-wide client.
 *
 * The setAll() try/catch matters: Server Components are allowed to *read*
 * cookies but not *write* them (Next.js throws if you try) — only Route
 * Handlers, Server Actions, and middleware can. Calling this from a Server
 * Component to just read the session is fine and the catch swallows the
 * write attempt; middleware.ts is what actually keeps the session cookie
 * refreshed so a stale/expired token doesn't linger.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component — see doc comment above.
        }
      },
    },
  });
}
