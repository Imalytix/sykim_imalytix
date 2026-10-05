"use client";

// 서버가 분석 전에 어차피 긴 변을 이 크기로 줄여서 쓰므로(lib/image/preprocess.ts의
// IMAGE_LONG_SIDE), 업로드 단계에서 이보다 크게 보낼 이유가 없다.
const MAX_LONG_SIDE = 1024;
const INITIAL_JPEG_QUALITY = 0.85;
const MIN_JPEG_QUALITY = 0.5;
const QUALITY_STEP = 0.15;

/**
 * 업로드하려는 파일이 maxBytes보다 크면 브라우저 Canvas로 리사이즈 + JPEG
 * 재압축해서 더 작은 File을 돌려준다. 이미 충분히 작으면 원본을 그대로
 * 반환한다(불필요한 재인코딩/화질 손실을 피하기 위함).
 *
 * 트레이드오프: Canvas는 픽셀만 다시 그려 내보내므로 EXIF 카메라 정보나 PNG에
 * 박힌 AI 생성 파라미터(Stable Diffusion/ComfyUI) 같은 메타데이터가 사라진다.
 * 다만 지금은 그런 파일이 크기 제한에 걸리면 업로드 자체가 막혀 비전 모델
 * 분석조차 못 받으므로, "메타데이터 신호 없이라도 분석은 된다"가 분명한
 * 개선이다 — 메타데이터 손실은 known trade-off로 받아들인다.
 *
 * 압축에 실패하거나(디코딩 불가 등) 목표 용량에 끝내 못 맞추면 원본을 그대로
 * 반환한다 — 호출부가 기존처럼 크기 초과 에러로 안내하면 된다(현재보다
 * 나빠지지 않는 안전한 폴백).
 */
export async function compressImageIfNeeded(file: File, maxBytes: number): Promise<File> {
  if (file.size <= maxBytes) return file;

  let bitmap: ImageBitmap;
  try {
    // imageOrientation: "from-image" — EXIF 방향 태그를 반영해 픽셀을 그린다.
    // 이걸 안 하면 세로로 찍은 아이폰 사진이 캔버스에 가로로 그려지고, 그
    // 상태로 내보낸 JPEG엔 EXIF 자체가 없어 서버도 더는 바로잡을 수 없다.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }

  const scale = Math.min(1, MAX_LONG_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const baseName = file.name.replace(/\.\w+$/, "") || "image";

  // 매 시도마다 지금까지 만든 것 중 가장 작은 blob을 들고 있는다 — 목표
  // 용량에 끝내 못 맞추더라도(극단적으로 복잡한 이미지 등) 원본보다 작게
  // 줄인 결과가 있다면 그걸 쓰는 편이 "그냥 원본 그대로 실패"보다 낫다.
  let smallest: Blob | null = null;
  for (let quality = INITIAL_JPEG_QUALITY; quality >= MIN_JPEG_QUALITY; quality -= QUALITY_STEP) {
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) break;
    if (!smallest || blob.size < smallest.size) smallest = blob;
    if (blob.size <= maxBytes) break;
  }

  if (smallest && smallest.size < file.size) {
    return new File([smallest], `${baseName}.jpg`, { type: "image/jpeg" });
  }
  return file;
}
