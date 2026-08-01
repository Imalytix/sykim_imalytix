import OpenAI from "openai";
import type { UsageInfo, VisionResult } from "@/types/analysis";
import { buildPrompt, detectImageType, QUICK_PROMPT, type PromptType } from "./prompts";
import { extractJsonObject, normalizeModelResult } from "./normalize";
import { classifyProviderError } from "./errorMessage";
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
  const standardPrompt = buildPrompt(promptType, imageType, "openai");

  const dataUrl = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;

  const client = new OpenAI({
    apiKey,
    timeout: Number(process.env.REQUEST_TIMEOUT_SECONDS || 60) * 1000,
  });

  // GPT-4o's vision safety layer occasionally refuses with a "can't identify
  // people in images" message even when the image has no people in it and the
  // prompt never asks for identification — this reproduces as genuinely
  // non-deterministic behavior (the *same* image + prompt succeeds on some
  // calls and refuses on others). Since it's a sampling artifact rather than
  // a deterministic content match, retrying is actually effective: attempt
  // the assigned prompt twice, then fall back to the short quick prompt once
  // before giving up.
  const attempts = promptType === "quick" ? [QUICK_PROMPT, QUICK_PROMPT] : [standardPrompt, standardPrompt, QUICK_PROMPT];

  // Latency covers the whole retry loop (all attempts), not just the last
  // one — that's the actual wall-clock cost this provider imposed on the
  // request, which is what a caller deciding "is OpenAI too slow" cares
  // about. Token usage, on the other hand, accumulates per-attempt (each
  // retry is a full billed call) — summed below rather than just kept from
  // the last attempt, since a 3-attempt refusal-retry genuinely costs 3x.
  const startedAt = Date.now();
  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let sawUsage = false;
  for (const attemptPrompt of attempts) {
    try {
      const attempt = await callOnce(client, modelName, attemptPrompt, dataUrl);
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
