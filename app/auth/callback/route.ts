import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/serverClient";

export const runtime = "nodejs";

/**
 * Where Supabase redirects back to after a social login (Google/Kakao/etc.)
 * or a magic-link email click — both flows land here with a `code` query
 * param that this exchanges for an actual session cookie. This route path
 * itself (`/auth/callback`) must be registered as an allowed Redirect URL
 * in the Supabase dashboard (Authentication → URL Configuration) or the
 * provider will refuse to redirect here at all — see the docs this round
 * writes to docs/ for the exact steps.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    console.error("[auth/callback] exchangeCodeForSession failed", error);
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
