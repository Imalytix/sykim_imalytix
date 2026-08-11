"use client";

import { useEffect, useState } from "react";

interface AnalysisStepsLoaderProps {
  active: boolean;
  /** Local preview of the image being analyzed — shown inside the loading
   *  card (실제 녹화 영상 기준: 체크보드 배경 위에 업로드한 이미지가 원형으로
   *  부드럽게 보이는 연출). */
  previewUrl: string | null;
}

// 디자인 요청: 검증이 끝날 때까지 아래 5개 문장이 2초 간격으로 순환 표시됨.
const STEPS = [
  "이미지 정보를 읽는 중..",
  "질감과 패턴을 분석하는 중..",
  "생성 흔적을 찾는 중..",
  "비슷한 이미지를 찾는 중..",
  "분석 결과를 종합하는 중..",
];
const STEP_INTERVAL_MS = 2000;

// 실제 백엔드에서 단계별 진행 이벤트를 받는 게 아니라 분석 요청 하나를 그냥
// await하는 구조라, 진짜 진행률은 알 수 없다 — 시간이 지날수록 92%에
// 점근하도록(1 - e^-t/k) 해서 항상 "거의 다 됐다"는 인상만 주는 근사치 진행바.
const PROGRESS_EASE_MS = 6000;
const PROGRESS_CAP = 0.92;

export default function AnalysisStepsLoader({ active, previewUrl }: AnalysisStepsLoaderProps) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);

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
    const timer = setInterval(() => setStepIndex((i) => (i + 1) % STEPS.length), STEP_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [active]);

  if (!active) return null;

  const elapsedSeconds = (elapsedMs / 1000).toFixed(1);
  const progressPercent = Math.round(PROGRESS_CAP * (1 - Math.exp(-elapsedMs / PROGRESS_EASE_MS)) * 100);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/95 backdrop-blur-sm" role="status" aria-live="polite">
      <div className="flex w-full max-w-[320px] flex-col items-center">
        {/* 체크보드 배경(처리중 느낌) 위에 실제 업로드한 이미지를 원형으로 부드럽게 페이드 */}
        <div
          className="relative flex h-64 w-64 items-center justify-center overflow-hidden rounded-3xl"
          style={{
            backgroundImage:
              "linear-gradient(45deg, #232328 25%, transparent 25%), linear-gradient(-45deg, #232328 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #232328 75%), linear-gradient(-45deg, transparent 75%, #232328 75%)",
            backgroundSize: "24px 24px",
            backgroundPosition: "0 0, 0 12px, 12px -12px, -12px 0px",
            backgroundColor: "#141416",
          }}
        >
          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- local blob/data URL preview, next/image adds no value here
            <img src={previewUrl} alt="분석 중인 이미지" className="h-full w-full object-cover" />
          )}
        </div>

        <p className="mt-6 text-[17px] font-bold text-[#f4f4f6]">이미지를 검증하고 있습니다</p>

        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-[#52bdff] transition-[width] duration-300 ease-out" style={{ width: `${progressPercent}%` }} />
        </div>
        <p className="mt-2.5 text-sm text-[#9a9aa4]">{STEPS[stepIndex]}</p>

        <div className="mt-5 rounded-full border border-white/12 bg-white/5 px-4 py-1.5 font-[family-name:var(--font-inter)] text-sm font-semibold tabular-nums text-[#60a5fa]">
          {elapsedSeconds}초 경과
        </div>
      </div>
    </div>
  );
}
