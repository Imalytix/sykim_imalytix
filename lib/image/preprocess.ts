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
