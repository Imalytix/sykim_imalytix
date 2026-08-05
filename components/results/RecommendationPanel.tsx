interface RecommendationPanelProps {
  recommendedAction: string;
}

/** "이 이미지를 어떻게 해석하면 좋을까요?" box — lives inside the white result
 *  card now (design handoff), so light-styled: pale blue tint on white, not
 *  the dark-card treatment this had before the 2026-08-06 design pass. */
export default function RecommendationPanel({ recommendedAction }: RecommendationPanelProps) {
  return (
    <div className="rounded-xl border border-[#52bdff]/30 bg-[#52bdff]/8 p-4">
      <div className="text-[13.5px] font-bold text-[#1a1a1a]">이 이미지를 어떻게 해석하면 좋을까요?</div>
      <p className="mt-1.5 text-[13px] leading-6 text-[#4a4a4a]">{recommendedAction}</p>
    </div>
  );
}
