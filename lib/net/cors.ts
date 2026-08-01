import { NextRequest, NextResponse } from "next/server";

// The web app calls this API same-origin (no CORS involved at all). The only
// cross-origin caller is extensions/chrome/sidepanel.js, whose Origin header
// is chrome-extension://<generated-id> — a different, random ID per install
// (dev "load unpacked" vs. a future Web Store listing), so it can't be
// allowlisted by a fixed value. Scoping the echo to the chrome-extension:
// scheme (rather than a blanket "*") keeps this from turning into an open
// CORS policy for arbitrary websites while still working for any install of
// this specific extension.
const EXTENSION_ORIGIN = /^chrome-extension:\/\//;

export function withExtensionCors(request: NextRequest, response: NextResponse): NextResponse {
  const origin = request.headers.get("origin");
  if (origin && EXTENSION_ORIGIN.test(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  }
  return response;
}

export function corsPreflightResponse(request: NextRequest): NextResponse {
  return withExtensionCors(request, new NextResponse(null, { status: 204 }));
}
