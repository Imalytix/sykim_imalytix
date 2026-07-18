import OpenAI from "openai";
import type { VisionResult } from "@/types/analysis";
import { buildPrompt, detectImageType, type PromptType } from "./prompts";
import { extractJsonObject, normalizeModelResult } from "./normalize";

const REFUSAL_PATTERNS = ["i'm sorry", "i cannot", "i can't", "i am unable", "as an ai", "sorry, i"];

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
  const prompt = buildPrompt(promptType, imageType, "openai");
  const dataUrl = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;

  const client = new OpenAI({
    apiKey,
    timeout: Number(process.env.REQUEST_TIMEOUT_SECONDS || 60) * 1000,
  });

  let text = "";
  try {
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
    text = response.output_text ?? "";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return normalizeModelResult(null, "openai", modelName, { errorMessage: `OpenAI API 호출 실패: ${message}` });
  }

  if (!text) {
    return normalizeModelResult(null, "openai", modelName, { errorMessage: "OpenAI 응답 텍스트가 없습니다." });
  }

  if (REFUSAL_PATTERNS.some((p) => text.toLowerCase().includes(p)) && text.length < 300) {
    return normalizeModelResult(null, "openai", modelName, {
      errorMessage: "OpenAI가 요청을 분석할 수 없습니다. (콘텐츠 정책)",
    });
  }

  const parsed = extractJsonObject(text);
  return normalizeModelResult(parsed ?? text, "openai", modelName);
}
