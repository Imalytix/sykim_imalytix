"use client";

import { useEffect, useRef, useState } from "react";

interface AnalysisStepsLoaderProps {
  active: boolean;
}

// loading.mp4 자체 배경색이 페이지의 순수 검정과 살짝 달라(짙은 남색 계열)
// 사각형 틀이 도드라져 보이는 문제 — 매 프레임 캔버스에 그려서 배경색에
// 가까운 픽셀을 투명 처리(크로마키)하면 회전하는 아이콘만 떠 있는 것처럼
// 보인다. 배경색은 하드코딩하지 않고 첫 프레임 모서리 픽셀에서 샘플링해
// (영상 파일이 나중에 바뀌어도) 계속 맞게 동작하도록 함.
//
// 또한 아이콘은 원본 프레임 안에서 작은 비중만 차지하므로, 배경을 투명
// 처리만 하고 캔버스를 키우면 아이콘 주위에 빈 여백만 커진다 — 첫 프레임에서
// 배경이 아닌 픽셀의 바운딩 박스를 구해 그 영역만 잘라서 그리면, 캔버스를
// 키웠을 때 아이콘 자체가 확대되어 보인다.
const KEY_THRESHOLD = 40; // 이 값보다 배경색과 가까우면 완전 투명
const KEY_SOFT_EDGE = 30; // 이 범위만큼 서서히 불투명해짐(계단현상 방지)
const CROP_PADDING = 6; // 바운딩 박스 여유 — 안티에일리어싱된 아이콘 가장자리가 잘리지 않도록

interface CropInfo {
  keyColor: [number, number, number];
  srcX: number;
  srcY: number;
  srcW: number;
  srcH: number;
}

export default function AnalysisStepsLoader({ active }: AnalysisStepsLoaderProps) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cropRef = useRef<CropInfo | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;
    const startedAt = Date.now();
    // 첫 tick(100ms 후)이 곧바로 0에 가까운 값으로 보정하므로, effect 본문에서
    // 동기적으로 setState를 호출하지 않아도(react-hooks/set-state-in-effect
    // 규칙 위반 방지) 실질적으로는 즉시 리셋된 것처럼 보입니다.
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt), 100);
    return () => clearInterval(timer);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    cropRef.current = null;

    /** 첫 프레임에서 배경색을 샘플링하고, 배경이 아닌 픽셀들의 바운딩 박스를
     *  구해 이후 프레임을 그 영역만 크롭해서 그리도록 설정한다. */
    function computeCrop(): CropInfo | null {
      if (!video || !canvas || !ctx || !video.videoWidth || !video.videoHeight) return null;
      const w = video.videoWidth;
      const h = video.videoHeight;
      const probe = document.createElement("canvas");
      probe.width = w;
      probe.height = h;
      const probeCtx = probe.getContext("2d");
      if (!probeCtx) return null;
      probeCtx.drawImage(video, 0, 0, w, h);
      const { data } = probeCtx.getImageData(0, 0, w, h);

      const corners = [0, (w - 1) * 4, (h - 1) * w * 4, (w * h - 1) * 4];
      let kr = 0;
      let kg = 0;
      let kb = 0;
      for (const idx of corners) {
        kr += data[idx];
        kg += data[idx + 1];
        kb += data[idx + 2];
      }
      kr /= corners.length;
      kg /= corners.length;
      kb /= corners.length;

      let minX = w;
      let minY = h;
      let maxX = 0;
      let maxY = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const dr = data[i] - kr;
          const dg = data[i + 1] - kg;
          const db = data[i + 2] - kb;
          if (Math.sqrt(dr * dr + dg * dg + db * db) > KEY_THRESHOLD) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      // 내용물을 못 찾았으면(전부 배경색이면) 크롭 없이 전체 프레임을 사용
      if (minX > maxX || minY > maxY) {
        return { keyColor: [kr, kg, kb], srcX: 0, srcY: 0, srcW: w, srcH: h };
      }
      const srcX = Math.max(0, minX - CROP_PADDING);
      const srcY = Math.max(0, minY - CROP_PADDING);
      const srcW = Math.min(w, maxX + CROP_PADDING) - srcX;
      const srcH = Math.min(h, maxY + CROP_PADDING) - srcY;
      return { keyColor: [kr, kg, kb], srcX, srcY, srcW, srcH };
    }

    const draw = () => {
      if (video.videoWidth && video.videoHeight) {
        if (!cropRef.current) cropRef.current = computeCrop();
        const crop = cropRef.current;
        if (crop) {
          if (canvas.width !== crop.srcW || canvas.height !== crop.srcH) {
            canvas.width = crop.srcW;
            canvas.height = crop.srcH;
          }
          ctx.drawImage(video, crop.srcX, crop.srcY, crop.srcW, crop.srcH, 0, 0, canvas.width, canvas.height);
          const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = frame.data;
          const [kr, kg, kb] = crop.keyColor;

          for (let i = 0; i < data.length; i += 4) {
            const dr = data[i] - kr;
            const dg = data[i + 1] - kg;
            const db = data[i + 2] - kb;
            const dist = Math.sqrt(dr * dr + dg * dg + db * db);
            if (dist <= KEY_THRESHOLD) {
              data[i + 3] = 0;
            } else if (dist <= KEY_THRESHOLD + KEY_SOFT_EDGE) {
              data[i + 3] = Math.round(((dist - KEY_THRESHOLD) / KEY_SOFT_EDGE) * 255);
            }
          }
          ctx.putImageData(frame, 0, 0);
        }
      }
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [active]);

  if (!active) return null;

  const elapsedSeconds = (elapsedMs / 1000).toFixed(1);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/95 backdrop-blur-sm" role="status" aria-live="polite">
      {/* 실제로 보이는 건 크로마키+크롭 처리된 canvas — video 자체는 프레임 소스로만 사용.
          display:none(Tailwind hidden)으로 숨기면 브라우저가 화면에 없는 video의 프레임
          디코딩을 멈춰버려 캔버스가 첫 프레임에서 정지해 보이는 문제가 있었음 — 레이아웃에는
          남기되(1px, opacity 0) 화면에는 안 보이게 해서 계속 디코딩되도록 함. */}
      <video ref={videoRef} src="/loading.mp4" autoPlay loop muted playsInline className="pointer-events-none absolute h-px w-px opacity-0" />
      <canvas ref={canvasRef} className="h-44 w-44 object-contain sm:h-56 sm:w-56" />
      <p className="mt-4 text-[17px] font-bold text-[#f4f4f6]">이미지를 분석하고 있습니다.</p>
      <p className="mt-1.5 text-sm text-[#9a9aa4]">여러 AI 모델과 메타데이터를 함께 확인하는 중입니다.</p>
      <div className="mt-6 rounded-full border border-white/12 bg-white/5 px-4 py-1.5 font-[family-name:var(--font-inter)] text-sm font-semibold tabular-nums text-[#60a5fa]">
        {elapsedSeconds}초 경과
      </div>
    </div>
  );
}
