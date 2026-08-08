import sharp from "sharp";

export interface PreprocessedImage {
  buffer: Buffer;
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * Normalizes any incoming image (any format/orientation) into a predictable
 * sRGB JPEG buffer, matching the Python pipeline's PIL.exif_transpose +
 * RGB flatten + long-side resize behavior.
 */
export async function preprocessImage(
  inputBuffer: Buffer,
  longSide: number,
): Promise<PreprocessedImage> {
  // failOn: "none"(가장 관대한 설정)이었을 때, 잘리거나 손상된 이미지도 sharp가
  // "최선을 다해" 픽셀을 채워 넣어 구조적으로는 유효한(그러나 내용은 깨진) JPEG를
  // 만들어냈다 — width/height 같은 메타데이터는 정상으로 읽혀서 앞단 검증도
  // 통과하고, 3개 AI 모델까지 그 깨진 이미지를 그대로 분석해 의미 없는 점수를
  // 냈다(브라우저에서는 깨진 이미지 아이콘으로 보임). "truncated"로 올려서
  // 픽셀 디코딩이 불완전하면 여기서 바로 실패하게 함 — 잡힌 에러는
  // pipeline.ts에서 ImageValidationError로 변환해 명확한 400을 반환한다.
  const image = sharp(inputBuffer, { failOn: "truncated" }).rotate(); // rotate() with no args = auto-orient from EXIF, then strips it
  const metadata = await image.metadata();

  // metadata.width/height ignore EXIF orientation (sharp's own docs say so);
  // .rotate() above *does* apply it, so for a 90°/270°-rotated photo the
  // pipeline's actual axes are swapped relative to these. metadata.autoOrient
  // gives the post-rotation dimensions instead, which is what "longest side"
  // needs to mean here — otherwise resize() constrains the wrong axis and
  // the true long side can end up larger than `longSide`.
  const width = metadata.autoOrient?.width ?? metadata.width ?? 0;
  const height = metadata.autoOrient?.height ?? metadata.height ?? 0;
  const longestSide = Math.max(width, height);

  let pipeline = image.flatten({ background: { r: 255, g: 255, b: 255 } });
  if (longestSide > longSide) {
    pipeline = pipeline.resize({
      width: longestSide === width ? longSide : undefined,
      height: longestSide === height ? longSide : undefined,
      fit: "inside",
      kernel: "lanczos3",
    });
  }

  const buffer = await pipeline.jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  const outMeta = await sharp(buffer).metadata();
  const dataUrl = `data:image/jpeg;base64,${buffer.toString("base64")}`;

  return {
    buffer,
    dataUrl,
    width: outMeta.width ?? width,
    height: outMeta.height ?? height,
  };
}
