import sharp from "sharp";
import type { AnalysisResult } from "@/types/analysis";
import { preprocessImage } from "@/lib/image/preprocess";
import { generatePHash } from "./phash";
import { analyzeMetadata } from "./metadata";
import { decideRouting } from "./router";
import { aggregateAnalysis } from "./aggregator";
import { analyzeWithOpenAI } from "@/lib/vision/openai";
import { analyzeWithGemini } from "@/lib/vision/gemini";
import { analyzeWithClaude } from "@/lib/vision/anthropic";
import { analyzeWithDino } from "./dino";
import { saveAnalyzedImage } from "@/lib/storage/imageStore";
import { findSimilarImages, insertImageRecord } from "@/lib/db/imageRecords";

export type AnalysisMode = "quick" | "standard" | "deep";

const FORMAT_TO_MIME: Record<string, string> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

export function makeRequestId(): string {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
  const random = Math.random().toString(16).slice(2, 8);
  return `req_${stamp}_${random}`;
}

export class ImageValidationError extends Error {}

export interface AnalyzeOutcome {
  result: AnalysisResult;
  /** Path (relative to project root) of the normalized image saved to local disk, or null if saving failed/was skipped. */
  imagePath: string | null;
}

export async function analyzeImageBytes(params: {
  imageBytes: Buffer;
  mode: AnalysisMode;
  inputType: "file_upload" | "image_url";
  sourceUrl?: string | null;
  filename?: string | null;
  requestId: string;
}): Promise<AnalyzeOutcome> {
  const { imageBytes, mode, inputType, sourceUrl, filename, requestId } = params;

  const originalMeta = await sharp(imageBytes, { failOn: "none" })
    .metadata()
    .catch(() => {
      throw new ImageValidationError("이미지를 읽을 수 없습니다. 지원되는 형식(JPEG/PNG/WEBP)인지 확인해주세요.");
    });

  if (!originalMeta.width || !originalMeta.height) {
    throw new ImageValidationError("이미지를 읽을 수 없습니다. 지원되는 형식(JPEG/PNG/WEBP)인지 확인해주세요.");
  }

  const mimeType = FORMAT_TO_MIME[originalMeta.format ?? ""] ?? "application/octet-stream";
  const isPng = originalMeta.format === "png";

  const longSide = Number(process.env.IMAGE_LONG_SIDE || 1024);
  const preprocessed = await preprocessImage(imageBytes, longSide);
  const phash = await generatePHash(preprocessed.buffer);

  // Kicked off alongside metadata/vision analysis — independent of both, and
  // its result isn't needed until the response is assembled at the end.
  const duplicateCheckPromise = findSimilarImages(phash);

  const metadataResult = await analyzeMetadata(imageBytes, { sourceUrl, filename, isPng });

  const routing = decideRouting(mode, metadataResult, {
    openai: Boolean(process.env.OPENAI_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY),
    claude: Boolean(process.env.ANTHROPIC_API_KEY),
  });

  const providerCalls: Array<Promise<Awaited<ReturnType<typeof analyzeWithOpenAI>>>> = [];
  if (routing.call_openai) providerCalls.push(analyzeWithOpenAI(preprocessed.buffer, "image/jpeg", routing.prompt_type));
  if (routing.call_gemini) providerCalls.push(analyzeWithGemini(preprocessed.buffer, "image/jpeg", routing.prompt_type));
  if (routing.call_claude) providerCalls.push(analyzeWithClaude(preprocessed.buffer, "image/jpeg", routing.prompt_type));
  // Opt-in (not opt-out): unlike the LLMs, a missing DINO service fails via a
  // 10s timeout per call (see dino.ts), which would tax every request if it
  // were on by default in an environment where ml/serve.py isn't running.
  if (process.env.IMALYTIX_ENABLE_DINO === "true") providerCalls.push(analyzeWithDino(preprocessed.buffer));

  const visionResults = providerCalls.length > 0 ? await Promise.all(providerCalls) : [];

  const aggregateResult = aggregateAnalysis(metadataResult, visionResults);

  // Best-effort local save of the exact (normalized) bytes that were analyzed —
  // never let a storage failure fail the analysis itself.
  const imagePath = await saveAnalyzedImage(requestId, preprocessed.buffer);

  const similarMatches = await duplicateCheckPromise;
  const duplicateCheck = {
    checked: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    matches: similarMatches,
  };

  const result: AnalysisResult = {
    product: "Imalytix",
    request_id: requestId,
    mode,
    input: {
      type: inputType,
      mime_type: mimeType,
      width: originalMeta.width,
      height: originalMeta.height,
      phash,
    },
    final_result: aggregateResult.final_result,
    metadata_analysis: metadataResult,
    vision_results: visionResults,
    evidence_summary: aggregateResult.evidence_summary,
    suspicious_regions: aggregateResult.suspicious_regions,
    limitations: [
      "AI 생성 여부는 100% 단정할 수 없습니다.",
      "SNS를 거친 이미지는 메타데이터가 제거되었을 수 있습니다.",
      "메타데이터는 수정 가능하므로 단독 판정 근거로 사용하지 않습니다.",
      ...aggregateResult.limitations,
    ],
    recommended_action: aggregateResult.recommended_action,
    duplicate_check: duplicateCheck,
  };

  // Best-effort — record this analysis so future requests can be compared
  // against it. Never let a DB hiccup fail the analysis itself.
  await insertImageRecord({
    requestId,
    phashHex: phash,
    isAiGenerated: result.final_result.is_ai_generated,
    aiProbability: result.final_result.ai_probability,
    imagePath,
    mode,
  });

  return { result, imagePath };
}
