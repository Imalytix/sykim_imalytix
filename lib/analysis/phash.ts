import sharp from "sharp";

const HASH_SIZE = 8;
const HIGH_FREQ_FACTOR = 4;
const IMAGE_SIZE = HASH_SIZE * HIGH_FREQ_FACTOR; // 32

/** 1D DCT-II (unnormalized — a constant overall scale factor doesn't
 *  change which coefficients end up above/below the median, so it's
 *  dropped here). */
function dct1d(input: Float64Array): Float64Array {
  const n = input.length;
  const output = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let sum = 0;
    for (let x = 0; x < n; x++) {
      sum += input[x] * Math.cos((Math.PI / n) * (x + 0.5) * k);
    }
    output[k] = sum;
  }
  return output;
}

function dct2d(matrix: Float64Array[]): Float64Array[] {
  const size = matrix.length;

  // DCT along columns (axis 0)
  const afterCols: Float64Array[] = Array.from({ length: size }, () => new Float64Array(size));
  for (let c = 0; c < size; c++) {
    const column = new Float64Array(size);
    for (let r = 0; r < size; r++) column[r] = matrix[r][c];
    const transformed = dct1d(column);
    for (let r = 0; r < size; r++) afterCols[r][c] = transformed[r];
  }

  // DCT along rows (axis 1)
  const result: Float64Array[] = Array.from({ length: size }, () => new Float64Array(size));
  for (let r = 0; r < size; r++) {
    result[r] = dct1d(afterCols[r]);
  }

  return result;
}

/**
 * Perceptual hash, ported from the `imagehash.phash` algorithm:
 * grayscale -> resize to 32x32 -> 2D DCT -> take the 8x8 low-frequency
 * block -> threshold against the median -> pack into a 64-bit hex hash.
 */
export async function generatePHash(inputBuffer: Buffer): Promise<string> {
  const { data } = await sharp(inputBuffer)
    .greyscale()
    .resize(IMAGE_SIZE, IMAGE_SIZE, { fit: "fill", kernel: "lanczos3" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels: Float64Array[] = Array.from({ length: IMAGE_SIZE }, (_, r) => {
    const row = new Float64Array(IMAGE_SIZE);
    for (let c = 0; c < IMAGE_SIZE; c++) row[c] = data[r * IMAGE_SIZE + c];
    return row;
  });

  const dct = dct2d(pixels);

  const lowFreq: number[] = [];
  for (let r = 0; r < HASH_SIZE; r++) {
    for (let c = 0; c < HASH_SIZE; c++) {
      lowFreq.push(dct[r][c]);
    }
  }

  const sorted = [...lowFreq].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

  const bits = lowFreq.map((value) => (value > median ? "1" : "0")).join("");
  const hexWidth = Math.ceil(bits.length / 4);
  return BigInt(`0b${bits}`).toString(16).padStart(hexWidth, "0");
}
