import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const ADMIN_PATH_PREFIXES = ["/admin", "/api/admin"];

/** Shared-password gate for the internal /admin/* review tool — separate
 *  from (and unrelated to) the Supabase session refresh below. Not a
 *  per-user permission system: anyone with the one shared password gets in,
 *  which is fine for a small team pointed at a known URL, but means there's
 *  no per-person audit trail or revocation. Fails closed if the env vars
 *  aren't set, rather than leaving the tool open. */
function hasValidAdminBasicAuth(request: NextRequest): boolean {
  const expectedUser = process.env.ADMIN_BASIC_AUTH_USER;
  const expectedPassword = process.env.ADMIN_BASIC_AUTH_PASSWORD;
  if (!expectedUser || !expectedPassword) return false;

  const header = request.headers.get("authorization");
  if (!header || !header.startsWith("Basic ")) return false;

  // atob/btoa are the Edge runtime's (and browsers') base64 primitives —
  // Buffer isn't available here.
  let decoded: string;
  try {
    decoded = atob(header.slice("Basic ".length));
  } catch {
    return false;
  }
  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex < 0) return false;
  return decoded.slice(0, separatorIndex) === expectedUser && decoded.slice(separatorIndex + 1) === expectedPassword;
}

function requireAdminBasicAuth(): NextResponse {
  return new NextResponse("인증이 필요합니다.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Imalytix Admin"' },
  });
}

/**
 * Refreshes the Supabase auth session cookie on every matched request (for
 * everything except the /admin/* tool, gated above by its own shared
 * password instead).
 *
 * Named `proxy` (not `middleware`) per this Next.js version's file
 * convention — `middleware.ts` is deprecated as of v16.0.0 and renamed to
 * `proxy.ts`/`export function proxy(...)` (see AGENTS.md: this codebase
 * targets a version with breaking changes from older Next.js docs/training
 * data, node_modules/next/dist/docs/.../proxy.md is the actual reference).
 *
 * Why this has to exist at all: Supabase sessions are short-lived access
 * tokens + a refresh token. Server Components can *read* cookies but can't
 * *write* them (see lib/supabase/serverClient.ts's comment) — so without
 * this, an expiring access token would never get refreshed on the server
 * side, and users would intermittently appear "logged out" even though
 * their refresh token was still valid. This runs before every page request
 * and re-issues a fresh session cookie when needed.
 *
 * Deliberately minimal — no route-protection/redirect logic here (that's
 * app/history/page.tsx's job, checked per-page). Mixing auth *gating* into
 * this file is exactly the mistake Supabase's own docs warn against: it
 * makes "why was I logged out" bugs much harder to trace. The /admin/* gate
 * above is the one deliberate exception — it's a different, unrelated auth
 * mechanism (a shared password, not a Supabase session), so it can't cause
 * that same confusion.
 */
export async function proxy(request: NextRequest) {
  if (ADMIN_PATH_PREFIXES.some((prefix) => request.nextUrl.pathname.startsWith(prefix))) {
    return hasValidAdminBasicAuth(request) ? NextResponse.next() : requireAdminBasicAuth();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Deliberately unused beyond triggering the refresh — do not remove this
  // call, it's the entire point (Supabase's own guidance: never skip
  // calling getUser() here, and don't add logic between the client and it).
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    // Skip static assets and Next's own internals — nothing there reads
    // the session, so refreshing it on every asset request is pure waste.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
