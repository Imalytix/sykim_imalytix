import { NextRequest, NextResponse } from "next/server";
import { analyzeImageBytes, ImageValidationError, makeRequestId, type AnalysisMode } from "@/lib/analysis/pipeline";
import { extractRequestContext, logAnalysisEvent } from "@/lib/logging/analysisLogger";
import { checkRateLimit } from "@/lib/security/rateLimit";

export const runtime = "nodejs";
export const maxDuration = 60;

const VALID_MODES: AnalysisMode[] = ["quick", "standard", "deep"];

export async function POST(request: NextRequest) {
  const requestId = makeRequestId();
  const context = extractRequestContext(request);
  const startedAt = Date.now();

  const rateLimit = checkRateLimit(context.ip);
  if (!rateLimit.allowed) {
    await logAnalysisEvent({
      status: "error",
      requestId,
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
  const maxBytes = Number(process.env.MAX_FILE_SIZE_MB || 10) * 1024 * 1024;
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) {
    await logAnalysisEvent({
      status: "error",
      requestId,
      durationMs: Date.now() - startedAt,
      context,
      inputType: "file_upload",
      mode: "standard",
      errorMessage: `요청 본문이 너무 큽니다 (Content-Length ${(declaredLength / (1024 * 1024)).toFixed(1)}MB > ${process.env.MAX_FILE_SIZE_MB || 10}MB).`,
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
    await logAnalysisEvent({
      status: "error",
      requestId,
      durationMs: Date.now() - startedAt,
      context,
      inputType: "file_upload",
      mode,
      filename: file.name,
      errorMessage: `이미지 파일이 너무 큽니다 (${(arrayBuffer.byteLength / (1024 * 1024)).toFixed(1)}MB > ${process.env.MAX_FILE_SIZE_MB || 10}MB).`,
    });
    return NextResponse.json({ detail: "이미지 파일이 너무 큽니다." }, { status: 400 });
  }

  try {
    const { result, imagePath } = await analyzeImageBytes({
      imageBytes: Buffer.from(arrayBuffer),
      mode,
      inputType: "file_upload",
      filename: file.name,
      requestId,
    });

    await logAnalysisEvent({
      status: "ok",
      requestId,
      durationMs: Date.now() - startedAt,
      context,
      inputType: "file_upload",
      mode,
      filename: file.name,
      imagePath,
      result,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ImageValidationError) {
      await logAnalysisEvent({
        status: "error",
        requestId,
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
    // to the console + the existing log sinks (local file / Supabase
    // `request_logs`), never into the client-facing response.
    const rawMessage = error instanceof Error ? error.message : String(error);
    console.error(`[api/analyze/image] request ${requestId} failed`, error);

    await logAnalysisEvent({
      status: "error",
      requestId,
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
