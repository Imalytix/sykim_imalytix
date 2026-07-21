import { NextRequest, NextResponse } from "next/server";
import { analyzeImageBytes, ImageValidationError, makeRequestId, type AnalysisMode } from "@/lib/analysis/pipeline";
import { extractRequestContext, logAnalysisEvent } from "@/lib/logging/analysisLogger";

export const runtime = "nodejs";
export const maxDuration = 60;

const VALID_MODES: AnalysisMode[] = ["quick", "standard", "deep"];

export async function POST(request: NextRequest) {
  const requestId = makeRequestId();
  const context = extractRequestContext(request);
  const startedAt = Date.now();

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

  const modeRaw = formData.get("mode");
  const mode: AnalysisMode = VALID_MODES.includes(modeRaw as AnalysisMode) ? (modeRaw as AnalysisMode) : "standard";

  const maxBytes = Number(process.env.MAX_FILE_SIZE_MB || 10) * 1024 * 1024;
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
    const message = error instanceof ImageValidationError ? error.message : error instanceof Error ? error.message : "이미지 분석 중 오류가 발생했습니다.";

    await logAnalysisEvent({
      status: "error",
      requestId,
      durationMs: Date.now() - startedAt,
      context,
      inputType: "file_upload",
      mode,
      filename: file.name,
      errorMessage: message,
    });

    if (error instanceof ImageValidationError) {
      return NextResponse.json({ detail: error.message }, { status: 400 });
    }
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
