import sharp from "sharp";
import type { AnalysisResult, SimilarImageMatch, VisionResult } from "@/types/analysis";
import { preprocessImage } from "@/lib/image/preprocess";
import { generatePHash } from "./phash";
import { analyzeMetadata } from "./metadata";
import { decideRouting } from "./router";
import { aggregateAnalysis, buildDuplicateAggregateResult, type AggregateResult } from "./aggregator";
import { analyzeWithOpenAI } from "@/lib/vision/openai";
import { analyzeWithGemini } from "@/lib/vision/gemini";
import { analyzeWithClaude } from "@/lib/vision/anthropic";
import { saveAnalyzedImage } from "@/lib/storage/imageStore";
import { findSimilarImages, recordVerification } from "@/lib/db/verification";
import type { RequestContext } from "@/lib/net/requestContext";

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

// The client-declared filename/extension/Content-Type are never trusted —
// they're trivially spoofable (rename a .exe to .jpg, or lie in the
// multipart Content-Type part). The only trustworthy check is what sharp's
// libvips actually decodes from the real bytes (chunk/magic-number level
// parsing), so this allowlist is enforced against `originalMeta.format`
// *after* a successful decode, not against anything the client sent. This
// also narrows accepted formats to the three advertised in the UI — sharp
// itself can decode several more (gif/avif/tiff/heif/svg depending on the
// libvips build), which would otherwise be silently accepted too.
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);

// pHash Hamming distance (out of 64 bits) at/under which two images are
// treated as "the same photo" (re-save/re-compression/minor resize), not
// merely similar — tight enough that visually-similar-but-distinct photos
// (which tend to land around distance 8-10) shouldn't trigger this. When
// matched, the LLM calls are skipped entirely and the earlier image's
// stored verdict is reused (see buildDuplicateAggregateResult) — heuristic,
// not yet calibrated against a real duplicate-vs-distinct distance
// distribution.
const EXACT_DUPLICATE_PHASH_DISTANCE = 3;

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
  /** Who's making this request (null when not logged in — analysis has
   *  never required an account and still doesn't). Attached to
   *  verification_requests.user_id so a future "내 분석 이력" page can
   *  find it; RLS on that table already restricts reads to the owner. */
  userId: string | null;
  context: RequestContext;
  /** Route handler's own start time (before rate-limit/size checks), so
   *  duration_ms reflects total request handling, not just this function's
   *  slice of it — matches what the old request_logs.duration_ms measured. */
  startedAt: number;
}): Promise<AnalyzeOutcome> {
  const { imageBytes, mode, inputType, sourceUrl, filename, requestId, userId, context, startedAt } = params;

  const originalMeta = await sharp(imageBytes, { failOn: "none" })
    .metadata()
    .catch(() => {
      throw new ImageValidationError("이미지를 읽을 수 없습니다. 지원되는 형식(JPEG/PNG/WEBP)인지 확인해주세요.");
    });

  if (!originalMeta.width || !originalMeta.height) {
    throw new ImageValidationError("이미지를 읽을 수 없습니다. 지원되는 형식(JPEG/PNG/WEBP)인지 확인해주세요.");
  }

  if (!originalMeta.format || !ALLOWED_FORMATS.has(originalMeta.format)) {
    throw new ImageValidationError(
      `지원하지 않는 이미지 형식입니다 (감지된 형식: ${originalMeta.format ?? "알 수 없음"}). JPEG/PNG/WEBP만 지원합니다.`,
    );
  }

  // originalMeta.width/height ignore EXIF orientation — for a rotated
  // portrait photo they report the pre-rotation (visually landscape) axes.
  // autoOrient reflects what the image actually looks like once displayed.
  const reportedWidth = originalMeta.autoOrient?.width ?? originalMeta.width;
  const reportedHeight = originalMeta.autoOrient?.height ?? originalMeta.height;

  const mimeType = FORMAT_TO_MIME[originalMeta.format ?? ""] ?? "application/octet-stream";
  const isPng = originalMeta.format === "png";

  const longSide = Number(process.env.IMAGE_LONG_SIDE || 1024);
  const preprocessed = await preprocessImage(imageBytes, longSide);
  const phash = await generatePHash(preprocessed.buffer);

  // Awaited here (not fire-and-forget) — unlike before, the exact-duplicate
  // fast path below needs this decided *before* choosing whether to call
  // the LLMs at all, not just to enrich the response at the end.
  //
  // Requiring full_result (not just distance + a verdict) means the fast
  // path only fires when there's an actual complete result to show — a
  // pre-migration row (full_result NULL) falls through to a real analysis
  // instead, which then populates full_result for that phash going forward.
  // Otherwise a duplicate-of-a-duplicate chain could get stuck showing an
  // empty "표시할 비전 모델 결과가 없습니다" section forever.
  const phashMatches = await findSimilarImages(phash);
  const exactDuplicate = phashMatches.find(
    (m) => m.distance <= EXACT_DUPLICATE_PHASH_DISTANCE && m.is_ai_generated !== null && m.full_result,
  );

  const metadataResult = await analyzeMetadata(imageBytes, {
    sourceUrl,
    filename,
    isPng,
    fileInfo: {
      format: originalMeta.format ?? null,
      width: reportedWidth,
      height: reportedHeight,
      size_bytes: imageBytes.length,
      color_space: originalMeta.space ?? null,
    },
  });

  let visionResults: VisionResult[] = [];
  let aggregateResult: AggregateResult;
  const similarMatches: SimilarImageMatch[] = phashMatches;

  if (exactDuplicate) {
    // Same photo (re-save/re-compression/minor resize) already analyzed —
    // reuse that earlier result wholesale (score AND the full provider/
    // evidence/region breakdown) instead of spending LLM calls to almost
    // certainly reproduce the same answer on pixel-identical bytes.
    const dup = buildDuplicateAggregateResult(exactDuplicate);
    aggregateResult = dup.aggregate;
    visionResults = dup.visionResults;
  } else {
    const routing = decideRouting(mode, metadataResult, {
      openai: Boolean(process.env.OPENAI_API_KEY),
      gemini: Boolean(process.env.GEMINI_API_KEY),
      claude: Boolean(process.env.ANTHROPIC_API_KEY),
    });

    const llmCalls: Array<Promise<Awaited<ReturnType<typeof analyzeWithOpenAI>>>> = [];
    if (routing.call_openai) llmCalls.push(analyzeWithOpenAI(preprocessed.buffer, "image/jpeg", routing.prompt_type));
    if (routing.call_gemini) llmCalls.push(analyzeWithGemini(preprocessed.buffer, "image/jpeg", routing.prompt_type));
    if (routing.call_claude) llmCalls.push(analyzeWithClaude(preprocessed.buffer, "image/jpeg", routing.prompt_type));

    visionResults = llmCalls.length > 0 ? await Promise.all(llmCalls) : [];

    aggregateResult = aggregateAnalysis(metadataResult, visionResults, similarMatches);
  }

  // Best-effort save of the exact (normalized) bytes that were analyzed —
  // never let a storage failure fail the analysis itself.
  const imagePath = await saveAnalyzedImage(requestId, preprocessed.buffer);

  const duplicateCheck = {
    checked: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    matches: similarMatches,
    used_cached_result: Boolean(exactDuplicate),
    influenced_score: aggregateResult.used_similar_match,
  };

  const result: AnalysisResult = {
    product: "Imalytix",
    request_id: requestId,
    mode,
    input: {
      type: inputType,
      mime_type: mimeType,
      width: reportedWidth,
      height: reportedHeight,
      phash,
    },
    analyzed_image_data_url: preprocessed.dataUrl,
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
  // against it (and, if logged in, so it shows up in "내 분석 이력"). Never
  // let a DB hiccup fail the analysis itself. visionResults here is either
  // freshly computed or (on an exact-duplicate hit) copied from the matched
  // request — either way it's the right thing to show in verification_
  // evidence, but loggedProviderCalls:false on the duplicate path stops that
  // reused data from also being logged as a fresh (and non-existent) API call.
  await recordVerification({
    requestId,
    userId,
    inputType,
    mode,
    status: "ok",
    durationMs: Date.now() - startedAt,
    context,
    sourceUrl,
    filename,
    image: {
      phashHex: phash,
      width: reportedWidth,
      height: reportedHeight,
      mimeType,
      fileSizeBytes: imageBytes.length,
      imagePath,
    },
    visionResults,
    loggedProviderCalls: !exactDuplicate,
    metadataResult,
    finalResult: result.final_result,
    evidenceSummary: result.evidence_summary,
    suspiciousRegions: result.suspicious_regions,
    limitations: result.limitations,
    recommendedAction: result.recommended_action,
  });

  return { result, imagePath };
}
