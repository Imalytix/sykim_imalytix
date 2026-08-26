import { NextRequest, NextResponse } from "next/server";
import { analyzeImageBytes, ImageValidationError, makeRequestId, type AnalysisMode } from "@/lib/analysis/pipeline";
import { extractRequestContext } from "@/lib/net/requestContext";
import { recordVerification } from "@/lib/db/verification";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { createSupabaseServerClient } from "@/lib/supabase/serverClient";

export const runtime = "nodejs";
// 60이 아니라 10인 이유: Vercel은 플랜/설정이 허용하는 상한을 넘는 maxDuration을
// 가진 함수를 아예 서빙하지 않는다. 그러면 그 라우트로 오는 모든 요청이 메서드와
// 무관하게 정적 /500 페이지로 떨어진다(X-Matched-Path: /500, Allow 헤더 없음) —
// 함수가 호출조차 되지 않으니 우리 try/catch도 못 돌고, 클라이언트에는 원인 없는
// "분석에 실패했습니다."만 남는다. maxDuration을 안 붙인 /api/health와
// /api/feedback은 멀쩡했고, 60을 붙인 이 라우트와 image-url만 죽어 있었다.
// Fluid Compute가 꺼진 Hobby의 상한이 10초라 어느 설정에서도 유효한 값으로 낮춘다.
// Fluid Compute를 켜면 60까지 올릴 수 있고, 그때 VISION_BUDGET_SECONDS도 같이 올릴 것.
// maxDuration은 정적 리터럴이어야 해서(빌드 타임 분석) 환경변수로 뺄 수 없다.
export const maxDuration = 10;

const VALID_MODES: AnalysisMode[] = ["quick", "standard", "deep"];

export async function POST(request: NextRequest) {
  const requestId = makeRequestId();
  const context = extractRequestContext(request);
  const startedAt = Date.now();

  // Analysis has never required an account and still doesn't — this is
  // just "attach the request to whoever's logged in, if anyone" so it can
  // show up in a future "내 분석 이력" page. A missing/invalid session
  // resolves to null here rather than rejecting the request.
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
      inputType: "file_upload",
      mode: "standard",
      errorMessage: `Rate limit 초과 (IP: ${context.ip ?? "unknown"}).`,
    });
    return NextResponse.json(
      { detail: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
      { status: 429, headers: rateLimit.retryAfterSeconds ? { "Retry-After": String(rateLimit.retryAfterSeconds) } : undefined },
    );
  }

  // Reject oversized uploads by their declared Content-Length *before*
  // request.formData() buffers the whole body into memory — otherwise the
  // MAX_FILE_SIZE_MB check below only runs after the damage (memory
  // exhaustion) is already done. Requests without a Content-Length header
  // (e.g. chunked transfer-encoding) fall through to the post-buffering
  // check, which is a known gap of this header-based approach.
  // 기본값 4MB — Vercel Serverless Function의 요청/응답 본문 4.5MB 하드 리밋보다
  // 낮게 잡아야, 그 한도를 넘는 요청이 우리 코드까지 오기 전에 플랫폼에서
  // JSON이 아닌 응답으로 끊기는(클라이언트에서 파싱 에러로 보이는) 상황을
  // 피할 수 있음. (https://vercel.com/docs/functions/limitations#request-body-size)
  const maxMb = Number(process.env.MAX_FILE_SIZE_MB || 4);
  const maxBytes = maxMb * 1024 * 1024;
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) {
    await recordVerification({
      requestId,
      userId,
      status: "error",
      durationMs: Date.now() - startedAt,
      context,
      inputType: "file_upload",
      mode: "standard",
      errorMessage: `요청 본문이 너무 큽니다 (Content-Length ${(declaredLength / (1024 * 1024)).toFixed(1)}MB > ${maxMb}MB).`,
    });
    return NextResponse.json({ detail: "이미지 파일이 너무 큽니다." }, { status: 413 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ detail: "multipart/form-data 요청이 필요합니다." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ detail: "file이 필요합니다." }, { status: 400 });
  }

  // Cheap, spoofable pre-check (a renamed .exe passes this) — rejects the
  // obviously-wrong case fast, before spending a sharp decode on it. The
  // real, trustworthy validation is analyzeImageBytes()'s allowlist against
  // what sharp actually decodes from the bytes (see pipeline.ts ALLOWED_FORMATS).
  const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
  const hasAllowedExtension = ALLOWED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));
  if (!hasAllowedExtension) {
    return NextResponse.json({ detail: "지원하지 않는 파일 확장자입니다. JPG/PNG/WEBP 파일만 업로드해주세요." }, { status: 400 });
  }

  const modeRaw = formData.get("mode");
  const mode: AnalysisMode = VALID_MODES.includes(modeRaw as AnalysisMode) ? (modeRaw as AnalysisMode) : "standard";

  const arrayBuffer = await file.arrayBuffer();
  if (arrayBuffer.byteLength > maxBytes) {
    await recordVerification({
      requestId,
      userId,
      status: "error",
      durationMs: Date.now() - startedAt,
      context,
      inputType: "file_upload",
      mode,
      filename: file.name,
      errorMessage: `이미지 파일이 너무 큽니다 (${(arrayBuffer.byteLength / (1024 * 1024)).toFixed(1)}MB > ${maxMb}MB).`,
    });
    return NextResponse.json({ detail: "이미지 파일이 너무 큽니다." }, { status: 400 });
  }

  try {
    // On success, analyzeImageBytes() itself records the full result (see
    // pipeline.ts's recordVerification call at its end) — nothing more to
    // do here beyond returning it.
    const { result } = await analyzeImageBytes({
      imageBytes: Buffer.from(arrayBuffer),
      mode,
      inputType: "file_upload",
      filename: file.name,
      requestId,
      userId,
      context,
      startedAt,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ImageValidationError) {
      await recordVerification({
        requestId,
        userId,
        status: "error",
        durationMs: Date.now() - startedAt,
        context,
        inputType: "file_upload",
        mode,
        filename: file.name,
        errorMessage: error.message,
      });
      return NextResponse.json({ detail: error.message }, { status: 400 });
    }

    // Unexpected (non-validation) failures can carry internal detail — a
    // sharp/Supabase/vision-SDK error message, sometimes with a filesystem
    // path or account info. That detail is only safe on the server: it goes
    // to the console + verification_requests.error_message, never into the
    // client-facing response.
    const rawMessage = error instanceof Error ? error.message : String(error);
    console.error(`[api/analyze/image] request ${requestId} failed`, error);

    await recordVerification({
      requestId,
      userId,
      status: "error",
      durationMs: Date.now() - startedAt,
      context,
      inputType: "file_upload",
      mode,
      filename: file.name,
      errorMessage: rawMessage,
    });

    return NextResponse.json(
      { detail: `이미지 분석 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요. (요청 ID: ${requestId})` },
      { status: 500 },
    );
  }
}
