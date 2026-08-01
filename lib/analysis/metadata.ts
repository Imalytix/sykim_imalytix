import { inflateSync } from "node:zlib";
import * as exifr from "exifr";
import type { CameraInfo, FileInfo, MetadataAnalysis } from "@/types/analysis";

export const AI_SOFTWARE_KEYWORDS = [
  "midjourney",
  "dall-e",
  "dalle",
  "openai",
  "chatgpt",
  "stable diffusion",
  "stability ai",
  "comfyui",
  "automatic1111",
  "a1111",
  "firefly",
  "adobe firefly",
  "runway",
  "sora",
  "leonardo",
  "ideogram",
  "flux",
  "krea",
  "recraft",
  "playground",
  "dreamstudio",
  "novelai",
];

function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Buffer.isBuffer(value)) return value.toString("utf-8");
  return String(value);
}

/** EXIF ExposureTime is decimal seconds (e.g. 0.008333) — display as a
 *  fraction (the conventional camera-settings format) when under a second. */
function formatExposureTime(value: unknown): string | null {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds >= 1) return `${seconds}s`;
  return `1/${Math.round(1 / seconds)}s`;
}

function formatFNumber(value: unknown): string | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `ƒ${n}`;
}

/** exifr auto-converts EXIF date tags to JS Date instances; guard against
 *  the raw string/invalid-date cases too since malformed EXIF isn't rare. */
function formatCapturedAt(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

/** Reads PNG tEXt/iTXt chunks (ComfyUI/A1111 embed generation params here). */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readPngTextChunks(buffer: Buffer): Record<string, string> {
  const chunks: Record<string, string> = {};
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return chunks;

  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) break;

    if (type === "tEXt") {
      const chunkData = buffer.subarray(dataStart, dataEnd);
      const nullIndex = chunkData.indexOf(0);
      if (nullIndex >= 0) {
        const key = chunkData.subarray(0, nullIndex).toString("latin1").toLowerCase();
        const value = chunkData.subarray(nullIndex + 1).toString("latin1");
        chunks[key] = value;
      }
    } else if (type === "iTXt") {
      const chunkData = buffer.subarray(dataStart, dataEnd);
      const keywordEnd = chunkData.indexOf(0);
      if (keywordEnd >= 0) {
        const key = chunkData.subarray(0, keywordEnd).toString("latin1").toLowerCase();
        // iTXt layout after the keyword's null terminator:
        //   compression flag (1B) | compression method (1B) |
        //   language tag (null-terminated) | translated keyword (null-terminated) | text
        // Tools that embed generation params sometimes zlib-compress this
        // (compression flag = 1) — decoding the raw bytes as UTF-8 in that
        // case yields garbage and silently loses the AI-tool evidence below.
        const compressionFlag = chunkData[keywordEnd + 1];
        const langStart = keywordEnd + 3; // skip flag + method bytes
        const langEnd = chunkData.indexOf(0, langStart);
        const translatedStart = langEnd >= 0 ? langEnd + 1 : langStart;
        const translatedEnd = langEnd >= 0 ? chunkData.indexOf(0, translatedStart) : -1;
        const textStart = translatedEnd >= 0 ? translatedEnd + 1 : translatedStart;
        const textBytes = chunkData.subarray(textStart);

        let text = "";
        if (compressionFlag === 1) {
          try {
            text = inflateSync(textBytes).toString("utf-8");
          } catch {
            // Corrupt/partial compressed payload — skip rather than store garbage.
            text = "";
          }
        } else {
          text = textBytes.toString("utf-8").replace(/\0/g, "");
        }
        if (text) chunks[key] = text;
      }
    }

    if (type === "IEND") break;
    offset = dataEnd + 4; // skip CRC
  }

  return chunks;
}

export async function analyzeMetadata(
  imageBuffer: Buffer,
  options: {
    sourceUrl?: string | null;
    filename?: string | null;
    isPng?: boolean;
    /** Passed in from pipeline.ts's already-decoded sharp metadata rather
     *  than re-decoding the same bytes here a second time. */
    fileInfo: FileInfo;
  },
): Promise<MetadataAnalysis> {
  const { sourceUrl, isPng, fileInfo } = options;

  let exifFound = false;
  let pngMetadataFound = false;
  let aiToolDetected = false;
  const detectedTools: string[] = [];
  const evidence: string[] = [];
  const limitations: string[] = [
    "메타데이터는 수정 가능하므로 단독 판정 근거로 사용하지 않습니다.",
  ];
  const raw: Record<string, unknown> = {};
  let score = 0;

  let exifData: Record<string, unknown> = {};
  try {
    const parsed = await exifr.parse(imageBuffer, { pick: undefined });
    if (parsed) {
      exifData = parsed as Record<string, unknown>;
      exifFound = true;
    }
  } catch {
    exifData = {};
  }

  let software = "";
  let make = "";
  let model = "";
  let lensModel = "";
  let capturedAt: string | null = null;
  let exposureTime: string | null = null;
  let fNumber: string | null = null;
  let iso: number | null = null;
  let hasGps = false;
  for (const [key, value] of Object.entries(exifData)) {
    const keyLower = key.toLowerCase();
    if (keyLower.includes("software")) software = toText(value);
    else if (keyLower.includes("lens")) lensModel = toText(value);
    else if (keyLower === "make") make = toText(value);
    else if (keyLower === "model") model = toText(value);
    else if (keyLower === "datetimeoriginal" || (keyLower === "createdate" && !capturedAt)) capturedAt = formatCapturedAt(value) ?? capturedAt;
    else if (keyLower === "exposuretime") exposureTime = formatExposureTime(value);
    else if (keyLower === "fnumber") fNumber = formatFNumber(value);
    else if (keyLower === "iso" || keyLower === "isospeedratings") iso = Number.isFinite(Number(value)) ? Number(value) : null;
    else if (keyLower === "gpslatitude" || keyLower === "gpslongitude" || keyLower === "latitude" || keyLower === "longitude") hasGps = true;
  }

  const cameraInfo: CameraInfo | null =
    make || model || lensModel || capturedAt || exposureTime || fNumber || iso
      ? {
          make: make || null,
          model: model || null,
          lens_model: lensModel || null,
          captured_at: capturedAt,
          exposure_time: exposureTime,
          f_number: fNumber,
          iso,
          has_gps: hasGps,
        }
      : null;

  if (software) {
    raw.software = software;
    if (AI_SOFTWARE_KEYWORDS.some((keyword) => software.toLowerCase().includes(keyword))) {
      aiToolDetected = true;
      detectedTools.push(software);
      score += 35;
      evidence.push(`EXIF Software 태그에서 ${software} 흔적이 확인되었습니다.`);
    }
  }

  if (make && model) {
    raw.make = make;
    raw.model = model;
    score -= 10;
    evidence.push("카메라 Make/Model 정보가 확인되어 실제 촬영 가능성을 반영했습니다.");
  }
  if ((make || model || lensModel) && lensModel) {
    score -= 15;
    evidence.push("LensModel 등 촬영 정보가 확인되어 실제 카메라 사진의 가능성을 반영했습니다.");
  }

  const pngInfo = isPng ? readPngTextChunks(imageBuffer) : {};
  if (Object.keys(pngInfo).length > 0) {
    if (isPng) pngMetadataFound = true;
    else if (["parameters", "prompt", "workflow", "negative_prompt"].some((k) => k in pngInfo)) {
      pngMetadataFound = true;
    }
  } else if (isPng) {
    pngMetadataFound = true;
  }

  if (pngInfo.prompt && pngInfo.prompt.trim()) {
    score += 30;
    evidence.push("PNG metadata에서 prompt 필드가 확인되었습니다.");
  }
  if (pngInfo.parameters && pngInfo.parameters.trim()) {
    const params = pngInfo.parameters.toLowerCase();
    if (["stable diffusion", "steps:", "sampler:", "cfg scale:", "seed:"].some((m) => params.includes(m))) {
      score += 35;
      aiToolDetected = true;
      detectedTools.push("Stable Diffusion");
      evidence.push("PNG parameters 필드에서 Stable Diffusion 생성 흔적이 확인되었습니다.");
    }
  }
  if (pngInfo.workflow && pngInfo.workflow.trim()) {
    try {
      const parsed = JSON.parse(pngInfo.workflow);
      if (parsed && typeof parsed === "object") {
        score += 35;
        aiToolDetected = true;
        detectedTools.push("ComfyUI");
        evidence.push("PNG workflow JSON에서 ComfyUI 흔적이 확인되었습니다.");
      }
    } catch {
      score += 20;
      evidence.push("PNG workflow 필드가 존재합니다.");
    }
  }

  for (const [key, value] of Object.entries(pngInfo)) {
    if (
      ["prompt", "negative_prompt", "workflow", "parameters", "seed", "sampler", "steps", "cfg scale", "model", "model hash"].includes(
        key,
      )
    ) {
      raw[key] = value;
    }
  }

  if (sourceUrl) {
    const lower = sourceUrl.toLowerCase();
    if (AI_SOFTWARE_KEYWORDS.some((keyword) => lower.includes(keyword))) {
      score += 10;
      evidence.push("이미지 URL 패턴에서 AI 생성 서비스 흔적이 확인되었습니다.");
    }
  }

  if (!exifFound && !pngMetadataFound) {
    limitations.push("메타데이터 부재는 흔한 상황이며 단독으로는 판정 근거가 되지 않습니다.");
  }

  score = Math.max(0, Math.min(100, score));

  return {
    exif_found: exifFound,
    png_metadata_found: pngMetadataFound,
    c2pa_found: false,
    ai_tool_detected: aiToolDetected,
    detected_tools: detectedTools,
    metadata_score: score,
    camera_make_model_found: Boolean(make && model),
    evidence,
    limitations,
    raw,
    camera_info: cameraInfo,
    file_info: fileInfo,
  };
}
