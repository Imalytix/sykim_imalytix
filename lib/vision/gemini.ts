import { GoogleGenAI, createPartFromBase64, createPartFromText } from "@google/genai";
import type { VisionResult } from "@/types/analysis";
import { buildPrompt, detectImageType, type PromptType } from "./prompts";
import { extractJsonObject, normalizeModelResult } from "./normalize";
import { describeProviderError } from "./errorMessage";

export async function analyzeWithGemini(
  imageBuffer: Buffer,
  mimeType: string,
  promptType: PromptType,
): Promise<VisionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  const modelName = process.env.GEMINI_VISION_MODEL || "gemini-2.5-flash";

  if (!apiKey) {
    return normalizeModelResult(null, "gemini", modelName, { errorMessage: "GEMINI_API_KEY가 설정되지 않았습니다." });
  }

  const imageType = await detectImageType(imageBuffer);
  const prompt = buildPrompt(promptType, imageType, "gemini");

  const client = new GoogleGenAI({ apiKey });

  let text = "";
  try {
    const response = await client.models.generateContent({
      model: modelName,
      contents: [createPartFromText(prompt), createPartFromBase64(imageBuffer.toString("base64"), mimeType)],
      config: {
        temperature: 0.1,
        maxOutputTokens: 2048,
        // Gemini 2.5 is a "thinking" model — without this, it can spend the
        // entire maxOutputTokens budget on invisible reasoning tokens before
        // writing any of the visible JSON answer, so the response gets cut
        // off mid-object and fails to parse. Matches the original Python
        // pipeline's thinking_budget=0 setting.
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    text = response.text ?? "";
  } catch (error) {
    return normalizeModelResult(null, "gemini", modelName, { errorMessage: describeProviderError(error, "Gemini") });
  }

  if (!text) {
    return normalizeModelResult(null, "gemini", modelName, { errorMessage: "Gemini 응답 텍스트가 없습니다." });
  }

  const parsed = extractJsonObject(text);
  return normalizeModelResult(parsed ?? text, "gemini", modelName);
}
