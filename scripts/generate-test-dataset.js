/**
 * Generates a small, reproducible set of synthetic test images under
 * test-data/images/, covering the main branches of the analysis pipeline:
 * format variety, the photo/illustration/pixel-art prompt split, the
 * metadata AI-tool/camera-EXIF detection paths, and the validation/size
 * rejection paths.
 *
 * All images are generated locally (no network, no third-party photos) so
 * the dataset is safe to regenerate anywhere and carries no licensing
 * concerns. Run with: node scripts/generate-test-dataset.js
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const OUT_DIR = path.join(__dirname, "..", "test-data", "images");

// ---- minimal PNG tEXt chunk writer (no external deps) ----------------------

function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return ~crc >>> 0;
}

function makeTextChunk(keyword, text) {
  const data = Buffer.concat([Buffer.from(keyword, "latin1"), Buffer.from([0]), Buffer.from(text, "latin1")]);
  const type = Buffer.from("tEXt", "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])), 0);
  return Buffer.concat([length, type, data, crc]);
}

/** Inserts tEXt chunks into a PNG buffer, right before the IEND chunk. */
function injectPngTextChunks(pngBuffer, fields) {
  const iendIndex = pngBuffer.lastIndexOf(Buffer.from("IEND", "ascii")) - 4; // back up to the length field
  const before = pngBuffer.subarray(0, iendIndex);
  const iendAndAfter = pngBuffer.subarray(iendIndex);
  const chunks = Object.entries(fields).map(([k, v]) => makeTextChunk(k, v));
  return Buffer.concat([before, ...chunks, iendAndAfter]);
}

// ---- scenarios --------------------------------------------------------------

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifest = [];

  async function write(name, description, bufferPromise) {
    const buffer = await bufferPromise;
    fs.writeFileSync(path.join(OUT_DIR, name), buffer);
    manifest.push({ file: name, description, bytes: buffer.length });
    console.log(`  ✓ ${name} (${(buffer.length / 1024).toFixed(1)} KB) — ${description}`);
  }

  console.log(`Generating test dataset into ${OUT_DIR}`);

  await write(
    "small-photo.jpg",
    "작은 사진형 이미지 (320x240, JPEG) — 기본 케이스",
    sharp({ create: { width: 320, height: 240, channels: 3, background: { r: 140, g: 150, b: 170 } } })
      .jpeg({ quality: 90 })
      .toBuffer(),
  );

  await write(
    "large-photo.jpg",
    "큰 사진형 이미지 (3000x2000) — IMAGE_LONG_SIDE 리사이즈 경로 + 지연시간 테스트",
    sharp({
      create: { width: 3000, height: 2000, channels: 3, background: { r: 100, g: 120, b: 90 } },
    })
      .composite([
        { input: { create: { width: 800, height: 800, channels: 3, background: { r: 250, g: 200, b: 90 } } }, left: 1100, top: 600 },
      ])
      .jpeg({ quality: 90 })
      .toBuffer(),
  );

  await write(
    "random-noise.jpg",
    "순수 노이즈 (640x480) — 실사/합성 판별이 어려운 극단 케이스",
    sharp({ create: { width: 640, height: 480, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 45 } } })
      .jpeg()
      .toBuffer(),
  );

  await write(
    "flat-illustration.png",
    "단색 도형 PNG — detectImageType()의 illustration 분기 테스트",
    sharp({ create: { width: 500, height: 500, channels: 3, background: { r: 255, g: 255, b: 255 } } })
      .composite([
        { input: { create: { width: 220, height: 220, channels: 3, background: { r: 235, g: 64, b: 52 } } }, left: 60, top: 60 },
        { input: { create: { width: 180, height: 180, channels: 3, background: { r: 52, g: 168, b: 235 } } }, left: 280, top: 260 },
      ])
      .png()
      .toBuffer(),
  );

  await write(
    "pixel-art.png",
    "16색 팔레트 픽셀아트 (32x32 → 256x256 nearest 업스케일) — pixel_art 분기 테스트",
    (async () => {
      const small = sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 20, g: 20, b: 20 } } })
        .composite([
          { input: { create: { width: 3, height: 3, channels: 3, background: { r: 255, g: 0, b: 0 } } }, left: 1, top: 1 },
          { input: { create: { width: 3, height: 3, channels: 3, background: { r: 0, g: 255, b: 0 } } }, left: 4, top: 4 },
        ])
        .png()
        .toBuffer();
      return sharp(await small).resize(256, 256, { kernel: "nearest" }).png().toBuffer();
    })(),
  );

  await write(
    "fake-ai-metadata.png",
    "PNG tEXt에 Stable Diffusion 파라미터 삽입 — metadata.ts의 AI 도구 탐지 경로 테스트 (metadata_score 높게 나와야 정상)",
    (async () => {
      const base = await sharp({ create: { width: 512, height: 512, channels: 3, background: { r: 180, g: 180, b: 190 } } })
        .png()
        .toBuffer();
      return injectPngTextChunks(base, {
        parameters: "a photo of a cat, Steps: 20, Sampler: Euler a, CFG scale: 7, Seed: 12345, Model: sd_xl_base",
        prompt: "a photo of a cat",
      });
    })(),
  );

  await write(
    "fake-camera-exif.jpg",
    "카메라 Make/Model/LensModel EXIF 포함 JPEG — 실제 촬영 가능성 반영(감점) 경로 테스트",
    sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 120, g: 140, b: 160 } } })
      .withExif({
        IFD0: { Make: "Canon", Model: "Canon EOS R5", Software: "Adobe Lightroom" },
        ExifIFD: { LensModel: "RF24-70mm F2.8 L IS USM" },
      })
      .jpeg({ quality: 90 })
      .toBuffer(),
  );

  await write(
    "photo.webp",
    "WEBP 포맷 지원 확인",
    sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 90, g: 110, b: 130 } } })
      .webp({ quality: 90 })
      .toBuffer(),
  );

  await write(
    "corrupt.jpg",
    "손상된 파일 (이미지 아님) — ImageValidationError(400) 경로 테스트",
    Promise.resolve(Buffer.from("this is not a real image file, just plain text bytes padded out a bit more")),
  );

  const maxMb = Number(process.env.MAX_FILE_SIZE_MB || 10);
  await write(
    "oversized.jpg",
    `MAX_FILE_SIZE_MB(${maxMb}MB) 초과 파일 — 크기 거부 경로 테스트 (route.ts가 sharp 디코딩 전에 byteLength만 보고 400을 반환하므로, 작은 이미지 뒤에 제로 패딩만 붙여도 충분함)`,
    (async () => {
      const targetBytes = (maxMb + 1) * 1024 * 1024;
      const img = await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 128, g: 128, b: 128 } } })
        .jpeg()
        .toBuffer();
      return Buffer.concat([img, Buffer.alloc(targetBytes - img.length, 0)]);
    })(),
  );

  fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\n${manifest.length}개 이미지 생성 완료 → ${OUT_DIR}`);
  console.log("실행: npm run test:perf");
}

main().catch((err) => {
  console.error("데이터셋 생성 실패:", err);
  process.exit(1);
});
