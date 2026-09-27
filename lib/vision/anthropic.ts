import Anthropic from "@anthropic-ai/sdk";
import type { UsageInfo, VisionResult } from "@/types/analysis";
import type { Locale } from "@/lib/i18n";
import { buildPrompt, detectImageType, type PromptType } from "./prompts";
import { extractJsonObject, normalizeModelResult } from "./normalize";
import { classifyProviderError } from "./errorMessage";
import { visionBudgetMs, withDeadline } from "./deadline";
import { estimateCostUsd } from "./pricing";

type AnthropicImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export async function analyzeWithClaude(
  imageBuffer: Buffer,
  mimeType: string,
  promptType: PromptType,
  locale: Locale = "ko",
): Promise<VisionResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const modelName = process.env.ANTHROPIC_VISION_MODEL || "claude-haiku-4-5-20251001";

  if (!apiKey) {
    return normalizeModelResult(null, "claude", modelName, {
      errorMessage: "ANTHROPIC_API_KEY is not configured.",
      errorCategory: "missing_api_key",
      isMock: true,
    });
  }

  const imageType = await detectImageType(imageBuffer);
  const prompt = buildPrompt(promptType, imageType, "claude", locale);

  // SDK 타임아웃도 비전 예산 아래로 묶는다 — 기본 60초는 함수 예산과 똑같아서
  // 실패를 JSON으로 돌려줄 여유가 0이었다(deadline.ts 참고).
  const budgetMs = visionBudgetMs();
  const client = new Anthropic({
    apiKey,
    timeout: Math.min(Number(process.env.REQUEST_TIMEOUT_SECONDS || 60) * 1000, budgetMs),
  });

  const startedAt = Date.now();
  let text = "";
  let usage: UsageInfo | null = null;
  try {
    const response = await withDeadline(
      client.messages.create({
        model: modelName,
        max_tokens: 2048,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mimeType as AnthropicImageMediaType,
                  data: imageBuffer.toString("base64"),
                },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
      budgetMs,
      "Claude",
    );
    const firstBlock = response.content[0];
    text = firstBlock && firstBlock.type === "text" ? firstBlock.text : "";
    const inputTokens = response.usage?.input_tokens ?? null;
    const outputTokens = response.usage?.output_tokens ?? null;
    if (inputTokens !== null || outputTokens !== null) {
      usage = { input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: estimateCostUsd(modelName, inputTokens, outputTokens) };
    }
  } catch (error) {
    const classified = classifyProviderError(error, "Claude");
    return normalizeModelResult(null, "claude", modelName, {
      errorMessage: classified.message,
      errorCategory: classified.category,
      isMock: true,
      latencyMs: Date.now() - startedAt,
    });
  }
  const latencyMs = Date.now() - startedAt;

  if (!text) {
    return normalizeModelResult(null, "claude", modelName, {
      errorMessage: "Claude returned an empty response.",
      errorCategory: "empty_response",
      isMock: true,
      latencyMs,
      usage,
    });
  }

  const parsed = extractJsonObject(text);
  return normalizeModelResult(parsed ?? text, "claude", modelName, { latencyMs, usage });
}
