import { NextRequest, NextResponse } from "next/server";
import { analyzeImageBytes, ImageValidationError, makeRequestId, type AnalysisMode } from "@/lib/analysis/pipeline";
import { safeFetchImage, SecurityViolationError } from "@/lib/net/safeFetch";
import { extractRequestContext } from "@/lib/net/requestContext";
import { recordVerification } from "@/lib/db/verification";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { corsPreflightResponse, withExtensionCors } from "@/lib/net/cors";
import { createSupabaseServerClient } from "@/lib/supabase/serverClient";
import { visionBudgetMs } from "@/lib/vision/deadline";

export const runtime = "nodejs";
// 상세한 이유는 app/api/analyze/image/route.ts의 같은 자리 주석 참고.
export const maxDuration = 60;

const VALID_MODES: AnalysisMode[] = ["quick", "standard", "deep"];

// This route's body is just { image_url, mode } — a legitimate request is at
// most a few hundred bytes. Anything wildly larger is either a mistake or an
// attempt to make the server buffer a huge JSON body before rejecting it.
const MAX_JSON_BODY_BYTES = 16 * 1024;

// Browsers preflight cross-origin POST+application/json with an OPTIONS
// request before sending the real one — extensions/chrome/sidepanel.js is
// the only caller that isn't same-origin, so this only actually matters for it.
export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

// 마지막 방어선 — 자세한 이유는 app/api/analyze/image/route.ts의 POST 주석 참고.
// handlePost()의 앞부분(세션 조회·레이트리밋·본문 파싱)이 자체 try 바깥이라,
// 여기서 안 잡으면 Next가 HTML 500을 내보내 클라이언트가 원인을 알 수 없게 된다.
export async function POST(request: NextRequest) {
  let response: NextResponse;
  try {
    response = await handlePost(request);
  } catch (error) {
    const requestId = makeRequestId();
    console.error(`[api/analyze/image-url] unhandled failure ${requestId}`, error);
    response = NextResponse.json(
      { detail: `이미지 분석 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요. (요청 ID: ${requestId})` },
      { status: 500 },
    );
  }
  return withExtensionCors(request, response);
}

async function handlePost(request: NextRequest): Promise<NextResponse> {
  const requestId = makeRequestId();
  const context = extractRequestContext(request);
  const startedAt = Date.now();

  // Analysis has never required an account and still doesn't — see the
  // matching comment in app/api/analyze/image/route.ts.
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user?.id ?? null;

  const rateLimit = checkRateLimit(context.ip);
  if (!rateLimit.allowed) {
    await recordVerification({
      requestId,
      userId,
      status: "error",
      durationMs: Date.now() - startedAt,
      context,
      inputType: "image_url",
      mode: "standard",
      errorMessage: `Rate limit 초과 (IP: ${context.ip ?? "unknown"}).`,
    });
    return NextResponse.json(
      { detail: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
      { status: 429, headers: rateLimit.retryAfterSeconds ? { "Retry-After": String(rateLimit.retryAfterSeconds) } : undefined },
    );
  }

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_JSON_BODY_BYTES) {
    await recordVerification({
      requestId,
      userId,
      status: "error",
      durationMs: Date.now() - startedAt,
      context,
      inputType: "image_url",
      mode: "standard",
      errorMessage: `요청 본문이 너무 큽니다 (Content-Length ${declaredLength} bytes > ${MAX_JSON_BODY_BYTES} bytes).`,
    });
    return NextResponse.json({ detail: "요청 본문이 너무 큽니다." }, { status: 413 });
  }

  let body: { image_url?: string; mode?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: "JSON 요청 본문이 필요합니다." }, { status: 400 });
  }

  const imageUrl = body.image_url?.trim();
  if (!imageUrl) {
    return NextResponse.json({ detail: "image_url이 필요합니다." }, { status: 400 });
  }

  const mode: AnalysisMode = VALID_MODES.includes(body.mode as AnalysisMode) ? (body.mode as AnalysisMode) : "standard";
  const maxBytes = Number(process.env.MAX_FILE_SIZE_MB || 10) * 1024 * 1024;
  // 이미지 내려받기도 함수 예산(maxDuration) 안에 들어와야 한다 — 기본 60초는
  // 예산의 여섯 배라, 느린 원본 URL 하나가 분석은 시작도 못 한 채 함수를 태워버렸다.
  const timeoutMs = Math.min(Number(process.env.REQUEST_TIMEOUT_SECONDS || 60) * 1000, visionBudgetMs());

  try {
    const downloaded = await safeFetchImage(imageUrl, maxBytes, timeoutMs);
    // On success, analyzeImageBytes() itself records the full result (see
    // pipeline.ts's recordVerification call at its end) — nothing more to
    // do here beyond returning it.
    const { result } = await analyzeImageBytes({
      imageBytes: downloaded.buffer,
      mode,
      inputType: "image_url",
      sourceUrl: downloaded.finalUrl,
      requestId,
      userId,
      context,
      startedAt,
    });

    return NextResponse.json(result);
  } catch (error) {
    // SecurityViolationError/ImageValidationError messages are deliberately
    // user-facing (they describe what's wrong with the *input* — a blocked
    // URL, a corrupt image), so it's fine to show them as-is. Anything else
    // is an internal failure (network stack, sharp, Supabase, vision SDKs)
    // that may carry paths/account details — that only goes to the console
    // and verification_requests.error_message, never the client response.
    if (error instanceof SecurityViolationError || error instanceof ImageValidationError) {
      await recordVerification({
        requestId,
        userId,
        status: "error",
        durationMs: Date.now() - startedAt,
        context,
        inputType: "image_url",
        mode,
        sourceUrl: imageUrl,
        errorMessage: error.message,
      });
      return NextResponse.json({ detail: error.message }, { status: 400 });
    }

    const rawMessage = error instanceof Error ? error.message : String(error);
    console.error(`[api/analyze/image-url] request ${requestId} failed`, error);

    await recordVerification({
      requestId,
      userId,
      status: "error",
      durationMs: Date.now() - startedAt,
      context,
      inputType: "image_url",
      mode,
      sourceUrl: imageUrl,
      errorMessage: rawMessage,
    });

    return NextResponse.json(
      { detail: `이미지 분석 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요. (요청 ID: ${requestId})` },
      { status: 500 },
    );
  }
}
