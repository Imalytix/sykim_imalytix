import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/client";
import { extractRequestContext } from "@/lib/net/requestContext";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { createSupabaseServerClient } from "@/lib/supabase/serverClient";

export const runtime = "nodejs";

// Free-text feedback, not an image analysis — no reason for this to ever be
// long. Caps both request-body size (before parsing) and the message field
// itself (after parsing) so a spam/abuse script can't post megabyte-sized
// bodies against a same-origin, unauthenticated endpoint.
const MAX_BODY_BYTES = 8 * 1024;
const MAX_MESSAGE_LENGTH = 2000;

export async function POST(request: NextRequest) {
  const context = extractRequestContext(request);

  // Same per-IP limiter as the analyze endpoints — this route is cheap
  // (one DB insert, no LLM calls), but still worth capping against a
  // scripted spam loop since it's open with no login.
  const rateLimit = checkRateLimit(context.ip);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { detail: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
      { status: 429, headers: rateLimit.retryAfterSeconds ? { "Retry-After": String(rateLimit.retryAfterSeconds) } : undefined },
    );
  }

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ detail: "요청 본문이 너무 큽니다." }, { status: 413 });
  }

  let body: { message?: string; request_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: "JSON 요청 본문이 필요합니다." }, { status: 400 });
  }

  const message = body.message?.trim();
  if (!message) {
    return NextResponse.json({ detail: "피드백 내용을 입력해주세요." }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ detail: `피드백은 ${MAX_MESSAGE_LENGTH}자 이내로 작성해주세요.` }, { status: 400 });
  }

  // request_id is only ever this app's own generated format (req_...) — not
  // trusted as a real FK, just stored as free text for manual cross-referencing.
  const requestId = typeof body.request_id === "string" ? body.request_id.slice(0, 100) : null;

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    // Best-effort, same posture as logging/storage — Supabase not configured
    // shouldn't surface as a user-facing failure for something this low-stakes.
    console.warn("[api/feedback] Supabase가 설정되지 않아 피드백을 저장하지 못했습니다");
    return NextResponse.json({ ok: true });
  }

  // Optional — feedback stays anonymous-submittable either way (see
  // schema.sql's feedback.user_id comment), this just attaches it when
  // someone happens to be signed in.
  const authClient = await createSupabaseServerClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  const { error } = await supabase.from("feedback").insert({
    request_id: requestId,
    user_id: user?.id ?? null,
    message,
    ip: context.ip,
    user_agent: context.userAgent,
  });

  if (error) {
    console.error("[api/feedback] insert failed", error);
    return NextResponse.json({ detail: "피드백 저장에 실패했습니다. 잠시 후 다시 시도해주세요." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
