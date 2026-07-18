import { GoogleGenerativeAI } from "@google/generative-ai";
import type { VisionResult } from "@/types/analysis";
import { buildPrompt, detectImageType, type PromptType } from "./prompts";
import { extractJsonObject, normalizeModelResult } from "./normalize";

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

  const client = new GoogleGenerativeAI(apiKey);
  const model = client.getGenerativeModel({
    model: modelName,
    generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
  });

  let text = "";
  try {
    const result = await model.generateContent([
      prompt,
      { inlineData: { data: imageBuffer.toString("base64"), mimeType } },
    ]);
    text = result.response.text() ?? "";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return normalizeModelResult(null, "gemini", modelName, { errorMessage: `Gemini API 호출 실패: ${message}` });
  }

  if (!text) {
    return normalizeModelResult(null, "gemini", modelName, { errorMessage: "Gemini 응답 텍스트가 없습니다." });
  }

  const parsed = extractJsonObject(text);
  return normalizeModelResult(parsed ?? text, "gemini", modelName);
}
