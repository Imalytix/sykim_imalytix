/**
 * Dumps every chunk in a PNG file — type, byte length, and (for tEXt/zTXt/
 * iTXt) the decoded key/value — so you can manually verify what
 * lib/analysis/metadata.ts's readPngTextChunks() will (or won't) see, without
 * running the full analysis pipeline.
 *
 * Usage:
 *   node scripts/inspect-png-chunks.js path/to/image.png
 */
const fs = require("fs");
const zlib = require("zlib");

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// tEXt: keyword \0 text (Latin-1, never compressed).
function decodeTEXt(data) {
  const nullIndex = data.indexOf(0);
  if (nullIndex < 0) return null;
  return { keyword: data.subarray(0, nullIndex).toString("latin1"), text: data.subarray(nullIndex + 1).toString("latin1") };
}

// zTXt: keyword \0 compression-method(1B) compressed-text (always zlib, Latin-1).
function decodeZTXt(data) {
  const nullIndex = data.indexOf(0);
  if (nullIndex < 0) return null;
  const keyword = data.subarray(0, nullIndex).toString("latin1");
  const compressed = data.subarray(nullIndex + 2); // skip null + compression method byte
  try {
    return { keyword, text: zlib.inflateSync(compressed).toString("latin1") };
  } catch (err) {
    return { keyword, text: null, error: `zlib inflate failed: ${err.message}` };
  }
}

// iTXt: keyword \0 compressionFlag(1B) compressionMethod(1B) langTag \0 translatedKeyword \0 text
// (text is UTF-8, optionally zlib-compressed per compressionFlag). Same logic as
// lib/analysis/metadata.ts's readPngTextChunks — kept in sync manually since this
// is a standalone debug script, not imported code.
function decodeITXt(data) {
  const keywordEnd = data.indexOf(0);
  if (keywordEnd < 0) return null;
  const keyword = data.subarray(0, keywordEnd).toString("latin1");
  const compressionFlag = data[keywordEnd + 1];
  const langStart = keywordEnd + 3;
  const langEnd = data.indexOf(0, langStart);
  const translatedStart = langEnd >= 0 ? langEnd + 1 : langStart;
  const translatedEnd = langEnd >= 0 ? data.indexOf(0, translatedStart) : -1;
  const textStart = translatedEnd >= 0 ? translatedEnd + 1 : translatedStart;
  const textBytes = data.subarray(textStart);

  if (compressionFlag === 1) {
    try {
      return { keyword, compressed: true, text: zlib.inflateSync(textBytes).toString("utf-8") };
    } catch (err) {
      return { keyword, compressed: true, text: null, error: `zlib inflate failed: ${err.message}` };
    }
  }
  return { keyword, compressed: false, text: textBytes.toString("utf-8") };
}

function inspect(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    console.error(`${filePath}: PNG 시그니처가 아닙니다 (PNG 파일이 맞는지 확인하세요).`);
    process.exit(1);
  }

  console.log(`${filePath} (${buffer.length} bytes)\n`);

  let offset = 8;
  let index = 0;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) {
      console.log(`  [${index}] ${type} — 청크가 파일 끝을 넘어갑니다 (손상된 파일?), 중단합니다.`);
      break;
    }
    const data = buffer.subarray(dataStart, dataEnd);

    let detail = "";
    if (type === "tEXt") {
      const decoded = decodeTEXt(data);
      detail = decoded ? ` — ${decoded.keyword} = ${JSON.stringify(decoded.text.slice(0, 200))}` : " — (파싱 실패)";
    } else if (type === "zTXt") {
      const decoded = decodeZTXt(data);
      // metadata.ts doesn't currently parse zTXt (only tEXt/iTXt) — flagged
      // here so a zTXt-carrying file explains why its AI-tool metadata
      // wasn't picked up by the actual analysis pipeline.
      detail = decoded
        ? ` — ${decoded.keyword} = ${decoded.text ? JSON.stringify(decoded.text.slice(0, 200)) : decoded.error} [경고: metadata.ts는 zTXt를 파싱하지 않음]`
        : " — (파싱 실패)";
    } else if (type === "iTXt") {
      const decoded = decodeITXt(data);
      detail = decoded
        ? ` — ${decoded.keyword} (compressed=${decoded.compressed}) = ${decoded.text ? JSON.stringify(decoded.text.slice(0, 200)) : decoded.error}`
        : " — (파싱 실패)";
    } else if (type === "IHDR") {
      const width = data.readUInt32BE(0);
      const height = data.readUInt32BE(4);
      detail = ` — ${width}x${height}, bit depth ${data[8]}, color type ${data[9]}`;
    }

    console.log(`  [${index}] ${type} (${length} bytes)${detail}`);
    if (type === "IEND") break;
    offset = dataEnd + 4;
    index += 1;
  }
}

const target = process.argv[2];
if (!target) {
  console.error("Usage: node scripts/inspect-png-chunks.js path/to/image.png");
  process.exit(1);
}
inspect(target);
