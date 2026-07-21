import OpenAI from "openai";
import type { VisionResult } from "@/types/analysis";
import { buildPrompt, detectImageType, QUICK_PROMPT, type PromptType } from "./prompts";
import { extractJsonObject, normalizeModelResult } from "./normalize";
import { describeProviderError } from "./errorMessage";

const REFUSAL_PATTERNS = ["i'm sorry", "i cannot", "i can't", "i am unable", "as an ai", "sorry, i"];

function looksLikeRefusal(text: string): boolean {
  return !text || (REFUSAL_PATTERNS.some((p) => text.toLowerCase().includes(p)) && text.length < 300);
}

async function callOnce(client: OpenAI, modelName: string, prompt: string, dataUrl: string): Promise<string> {
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
  return response.output_text ?? "";
}

export async function analyzeWithOpenAI(
  imageBuffer: Buffer,
  mimeType: string,
  promptType: PromptType,
): Promise<VisionResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  const modelName = process.env.OPENAI_VISION_MODEL || "gpt-4o";

  if (!apiKey) {
    return normalizeModelResult(null, "openai", modelName, { errorMessage: "OPENAI_API_KEY가 설정되지 않았습니다." });
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

  let text = "";
  for (const attemptPrompt of attempts) {
    try {
      text = await callOnce(client, modelName, attemptPrompt, dataUrl);
    } catch (error) {
      return normalizeModelResult(null, "openai", modelName, { errorMessage: describeProviderError(error, "OpenAI") });
    }
    if (!looksLikeRefusal(text)) break;
  }

  if (!text) {
    return normalizeModelResult(null, "openai", modelName, { errorMessage: "OpenAI 응답 텍스트가 없습니다." });
  }

  if (looksLikeRefusal(text)) {
    return normalizeModelResult(null, "openai", modelName, {
      errorMessage: "OpenAI가 요청을 분석할 수 없습니다. (콘텐츠 정책 — 여러 번 재시도했지만 계속 거절됨)",
    });
  }

  const parsed = extractJsonObject(text);
  return normalizeModelResult(parsed ?? text, "openai", modelName);
}
