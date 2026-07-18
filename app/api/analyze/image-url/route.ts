import { NextRequest, NextResponse } from "next/server";
import { analyzeImageBytes, ImageValidationError, type AnalysisMode } from "@/lib/analysis/pipeline";
import { safeFetchImage, SecurityViolationError } from "@/lib/net/safeFetch";

export const runtime = "nodejs";
export const maxDuration = 60;

const VALID_MODES: AnalysisMode[] = ["quick", "standard", "deep"];

export async function POST(request: NextRequest) {
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
  const timeoutMs = Number(process.env.REQUEST_TIMEOUT_SECONDS || 60) * 1000;

  try {
    const downloaded = await safeFetchImage(imageUrl, maxBytes, timeoutMs);
    const result = await analyzeImageBytes({
      imageBytes: downloaded.buffer,
      mode,
      inputType: "image_url",
      sourceUrl: downloaded.finalUrl,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SecurityViolationError || error instanceof ImageValidationError) {
      return NextResponse.json({ detail: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "이미지 분석 중 오류가 발생했습니다.";
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
