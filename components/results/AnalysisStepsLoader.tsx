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

  useEffect(() => {
    if (!active) {
      setCurrentStep(0);
      setCompletedSteps(new Set());
      return;
    }

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
    <div className={`rounded-2xl border border-slate-100 bg-white ${compact ? "p-4" : "p-6"} shadow-sm`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">분석 진행 현황</div>
          <div className="mt-1 text-xs text-slate-500">이미지 검증, 메타데이터, 시각 근거를 순서대로 확인 중입니다.</div>
        </div>
        <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{progress}%</div>
      </div>

      <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-slate-900 transition-all duration-300" style={{ width: `${progress}%` }} />
      </div>

      <ol className="mt-5 space-y-4">
        {STEPS.map((step, idx) => {
          const isDone = completedSteps.has(idx);
          const isActive = currentStep === idx && !isDone;
          const isPending = idx > currentStep;

          return (
            <li key={step.id} className="flex items-start gap-3">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white">
                {isDone ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : isActive ? (
                  <Loader2 className="h-4 w-4 animate-spin text-slate-900" />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-slate-200" />
                )}
              </div>
              <div className="min-w-0">
                <div
                  className={
                    isDone
                      ? "text-sm font-medium text-emerald-700"
                      : isActive
                        ? "text-sm font-semibold text-slate-900"
                        : "text-sm text-slate-400"
                  }
                >
                  {step.label}
                </div>
                <div className={`mt-0.5 text-xs ${isPending ? "text-slate-300" : "text-slate-500"}`}>{step.desc}</div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
