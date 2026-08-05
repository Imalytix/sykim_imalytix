"use client";

interface AnalysisStepsLoaderProps {
  active: boolean;
  compact?: boolean;
}

/** Matches the design handoff's loading screen — a looping brand-mark
 *  animation (public/loading.mp4) centered in a dark card, title + subtitle
 *  below it. Replaces the earlier step-by-step checklist loader entirely
 *  (2026-08-06 design-fidelity pass) rather than layering the video on top
 *  of it — the handoff doesn't show a checklist during loading. */
export default function AnalysisStepsLoader({ active, compact = false }: AnalysisStepsLoaderProps) {
  if (!active) return null;

  return (
    <div className={`flex flex-col items-center rounded-2xl border border-white/9 bg-white/[0.04] ${compact ? "p-8" : "p-12"}`}>
      <video
        src="/loading.mp4"
        autoPlay
        loop
        muted
        playsInline
        className={compact ? "h-20 w-20" : "h-28 w-28"}
      />
      <p className="mt-6 text-[15px] font-bold text-[#f4f4f6]">이미지를 분석하고 있습니다.</p>
      <p className="mt-1.5 text-center text-sm text-[#9a9aa4]">로그인하면 더 많은 기능을 사용할 수 있습니다.</p>
    </div>
  );
}
