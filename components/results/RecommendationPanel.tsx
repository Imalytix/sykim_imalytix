interface RecommendationPanelProps {
  recommendedAction: string;
  limitations: string[];
  aiProbability: number;
}

// aiProbability is accepted for API-compatibility with callers (page.tsx
// passes scorePercent) but no longer changes styling — this "interpretation"
// box stays a blue-accented card regardless of score (blue, not the
// red/green tone used for the verdict itself, since this isn't a
// danger/safe signal — it's neutral guidance).
export default function RecommendationPanel({ recommendedAction, limitations }: RecommendationPanelProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#3b82f6]/40 bg-[#3b82f6]/10 p-[22px]">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#60a5fa]" />
          <div className="text-[15px] font-bold tracking-tight text-[#f4f4f6]">이 이미지를 어떻게 보면 좋을까요?</div>
        </div>
        <p className="mt-2.5 text-[13.5px] leading-7 text-[#d4d4d9]">{recommendedAction}</p>
      </div>

      {limitations.length > 0 && (
        <div className="rounded-2xl border border-white/9 bg-white/[0.04] p-5">
          <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#6b6b76]">분석 한계</div>
          <ul className="space-y-2">
            {limitations.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm leading-6 text-[#9a9aa4]">
                <span className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-[#4a4a54]" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
