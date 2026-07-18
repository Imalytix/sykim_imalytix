export function toPercentageScore(score: number | undefined | null): number {
  if (score === undefined || score === null || Number.isNaN(score)) return 0;
  if (score <= 1) return Math.round(score * 100);
  return Math.round(Math.min(score, 100));
}

export function getScoreLabel(score: number): string {
  if (score >= 80) return "AI 생성물 가능성 높음";
  if (score >= 60) return "AI 생성 의심";
  if (score >= 31) return "판단 불확실";
  return "실제 이미지 가능성 높음";
}

export function getConfidenceTone(confidence: "low" | "medium" | "high"): string {
  if (confidence === "high") return "border-rose-200 bg-rose-50 text-rose-700";
  if (confidence === "medium") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-sky-200 bg-sky-50 text-sky-700";
}
