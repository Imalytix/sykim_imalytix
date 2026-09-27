import OpenAI from "openai";
import type { UsageInfo, VisionResult } from "@/types/analysis";
import type { Locale } from "@/lib/i18n";
import { buildPrompt, detectImageType, type PromptType } from "./prompts";
import { extractJsonObject, normalizeModelResult } from "./normalize";
import { classifyProviderError } from "./errorMessage";
import { visionBudgetMs, withDeadline } from "./deadline";
import { estimateCostUsd } from "./pricing";

const REFUSAL_PATTERNS = ["i'm sorry", "i cannot", "i can't", "i am unable", "as an ai", "sorry, i"];

function looksLikeRefusal(text: string): boolean {
  return !text || (REFUSAL_PATTERNS.some((p) => text.toLowerCase().includes(p)) && text.length < 300);
}

interface CallResult {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

async function callOnce(client: OpenAI, modelName: string, prompt: string, dataUrl: string): Promise<CallResult> {
  const response = await client.responses.create({
    model: modelName,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: dataUrl, detail: "auto" },
        ],
      },
    ],
  });
  return {
    text: response.output_text ?? "",
    inputTokens: response.usage?.input_tokens ?? null,
    outputTokens: response.usage?.output_tokens ?? null,
  };
}

export async function analyzeWithOpenAI(
  imageBuffer: Buffer,
  mimeType: string,
  promptType: PromptType,
  locale: Locale = "ko",
): Promise<VisionResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  const modelName = process.env.OPENAI_VISION_MODEL || "gpt-4o";

  if (!apiKey) {
    return normalizeModelResult(null, "openai", modelName, {
      errorMessage: "OPENAI_API_KEY가 설정되지 않았습니다.",
      errorCategory: "missing_api_key",
      isMock: true,
    });
  }

  const imageType = await detectImageType(imageBuffer);
  const standardPrompt = buildPrompt(promptType, imageType, "openai", locale);
  const quickPrompt = buildPrompt("quick", imageType, "openai", locale);

  const dataUrl = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;

  // SDK 타임아웃도 비전 예산 아래로 묶는다 — 기본 60초 × 아래 재시도 3번이면
  // 최악의 경우 180초로, 함수 예산(maxDuration 60초)의 세 배였다(deadline.ts 참고).
  const budgetMs = visionBudgetMs();
  const client = new OpenAI({
    apiKey,
    timeout: Math.min(Number(process.env.REQUEST_TIMEOUT_SECONDS || 60) * 1000, budgetMs),
  });

  // GPT-4o's vision safety layer occasionally refuses with a "can't identify
  // people in images" message even when the image has no people in it and the
  // prompt never asks for identification — this reproduces as genuinely
  // non-deterministic behavior (the *same* image + prompt succeeds on some
  // calls and refuses on others). Since it's a sampling artifact rather than
  // a deterministic content match, retrying is actually effective: attempt
  // the assigned prompt twice, then fall back to the short quick prompt once
  // before giving up.
  const attempts = promptType === "quick" ? [quickPrompt, quickPrompt] : [standardPrompt, standardPrompt, quickPrompt];

  // Latency covers the whole retry loop (all attempts), not just the last
  // one — that's the actual wall-clock cost this provider imposed on the
  // request, which is what a caller deciding "is OpenAI too slow" cares
  // about. Token usage, on the other hand, accumulates per-attempt (each
  // retry is a full billed call) — summed below rather than just kept from
  // the last attempt, since a 3-attempt refusal-retry genuinely costs 3x.
  const startedAt = Date.now();
  // 재시도는 횟수가 아니라 남은 예산이 정한다. 사람이 찍힌 사진에서 이 거절
  // 재시도가 자주 도는데, 예전에는 매 시도가 각자 60초를 쓸 수 있어서 세 번을
  // 다 돌면 함수가 먼저 죽었다 — 그 경우 Vercel이 비-JSON 에러 페이지를 내보내
  // 사용자에게는 원인 없는 "분석에 실패했습니다."만 남았다(deadline.ts 참고).
  const deadlineAt = startedAt + budgetMs;
  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let sawUsage = false;
  for (const [attemptIndex, attemptPrompt] of attempts.entries()) {
    const remainingMs = deadlineAt - Date.now();
    // 남은 시간으로 한 번 더 호출해봐야 마감에 걸릴 게 뻔하면, 지금까지 받은
    // 응답으로 마무리한다(아래 refusal/empty 처리가 그대로 결과를 만든다).
    // 단 이 확인은 재시도에만 적용한다 — 첫 시도까지 건너뛰면 호출을 아예
    // 안 한 채 "응답 텍스트가 없습니다"로 끝나서, 예산이 빠듯할 때 제공자가
    // 통째로 사라진다. 첫 시도는 예산이 얼마든 무조건 한 번은 해본다.
    if (attemptIndex > 0 && remainingMs < 5000) break;
    try {
      const attempt = await withDeadline(callOnce(client, modelName, attemptPrompt, dataUrl), Math.max(remainingMs, 1000), "OpenAI");
      text = attempt.text;
      if (attempt.inputTokens !== null) {
        inputTokens += attempt.inputTokens;
        sawUsage = true;
      }
      if (attempt.outputTokens !== null) {
        outputTokens += attempt.outputTokens;
        sawUsage = true;
      }
    } catch (error) {
      const classified = classifyProviderError(error, "OpenAI");
      return normalizeModelResult(null, "openai", modelName, {
        errorMessage: classified.message,
        errorCategory: classified.category,
        isMock: true,
        latencyMs: Date.now() - startedAt,
      });
    }
    if (!looksLikeRefusal(text)) break;
  }
  const latencyMs = Date.now() - startedAt;
  const usage: UsageInfo | null = sawUsage
    ? {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: estimateCostUsd(modelName, inputTokens, outputTokens),
      }
    : null;

  if (!text) {
    return normalizeModelResult(null, "openai", modelName, {
      errorMessage: "OpenAI 응답 텍스트가 없습니다.",
      errorCategory: "empty_response",
      isMock: true,
      latencyMs,
      usage,
    });
  }

  if (looksLikeRefusal(text)) {
    return normalizeModelResult(null, "openai", modelName, {
      errorMessage: "OpenAI가 요청을 분석할 수 없습니다. (콘텐츠 정책 — 여러 번 재시도했지만 계속 거절됨)",
      errorCategory: "content_policy",
      isMock: true,
      latencyMs,
      usage,
    });
  }

  const parsed = extractJsonObject(text);
  return normalizeModelResult(parsed ?? text, "openai", modelName, { latencyMs, usage });
}
