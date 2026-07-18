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
  const image = sharp(inputBuffer, { failOn: "none" }).rotate(); // rotate() with no args = auto-orient from EXIF, then strips it
  const metadata = await image.metadata();

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
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
