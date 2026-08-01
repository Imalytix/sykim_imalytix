"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const STEPS = [
  { id: "validate", label: "이미지 검증", desc: "파일 형식과 크기를 확인합니다." },
  { id: "metadata", label: "메타데이터 분석", desc: "EXIF, PNG 흔적을 확인합니다." },
  { id: "vision", label: "시각 분석", desc: "AI 생성 징후와 이상 구조를 살핍니다." },
  { id: "aggregate", label: "결과 정리", desc: "점수를 합산하고 최종 결과를 만듭니다." },
] as const;

const STEP_DURATIONS = [700, 1200, 1800, 700];

interface AnalysisStepsLoaderProps {
  active: boolean;
  compact?: boolean;
}

export default function AnalysisStepsLoader({ active, compact = false }: AnalysisStepsLoaderProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  // Reset step state during render when `active` flips off, rather than in an
  // effect — this is React's recommended way to adjust state in response to a
  // prop change (avoids an extra commit/cascading render).
  const [prevActive, setPrevActive] = useState(active);
  if (active !== prevActive) {
    setPrevActive(active);
    if (!active) {
      setCurrentStep(0);
      setCompletedSteps(new Set());
    }
  }

  useEffect(() => {
    if (!active) return;

    let stepIndex = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const run = () => {
      if (stepIndex >= STEPS.length) return;
      setCurrentStep(stepIndex);

      const duration = STEP_DURATIONS[stepIndex] ?? 1000;
      const timer = setTimeout(() => {
        setCompletedSteps((prev) => new Set([...prev, stepIndex]));
        stepIndex += 1;
        run();
      }, duration);

      timers.push(timer);
    };

    run();
    return () => timers.forEach(clearTimeout);
  }, [active]);

  const progress = useMemo(() => {
    if (!active) return 0;
    const done = completedSteps.size;
    return Math.round((done / STEPS.length) * 100);
  }, [active, completedSteps]);

  if (!active) return null;

  return (
    <div className={`rounded-2xl border border-white/9 bg-white/[0.04] ${compact ? "p-4" : "p-6"}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[#f4f4f6]">분석 진행 현황</div>
          <div className="mt-1 text-xs text-[#9a9aa4]">이미지 검증, 메타데이터, 시각 근거를 순서대로 확인 중입니다.</div>
        </div>
        <div className="rounded-full bg-[#3b82f6]/15 px-3 py-1 text-xs font-semibold text-[#60a5fa]">{progress}%</div>
      </div>

      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#3b82f6] to-[#60a5fa] shadow-[0_0_18px_rgba(59,130,246,0.7)] transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      <ol className="mt-5 space-y-4">
        {STEPS.map((step, idx) => {
          const isDone = completedSteps.has(idx);
          const isActive = currentStep === idx && !isDone;
          const isPending = idx > currentStep;

          return (
            <li key={step.id} className="flex items-start gap-3">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5">
                {isDone ? (
                  <CheckCircle2 className="h-4 w-4 text-[#4ade80]" />
                ) : isActive ? (
                  <Loader2 className="h-4 w-4 animate-spin text-[#60a5fa]" />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-white/15" />
                )}
              </div>
              <div className="min-w-0">
                <div
                  className={
                    isDone
                      ? "text-sm font-medium text-[#86efac]"
                      : isActive
                        ? "text-sm font-semibold text-[#f4f4f6]"
                        : "text-sm text-[#6b6b76]"
                  }
                >
                  {step.label}
                </div>
                <div className={`mt-0.5 text-xs ${isPending ? "text-[#4a4a54]" : "text-[#9a9aa4]"}`}>{step.desc}</div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
