/**
 * Converts a per-provider VisionResult.score (always a 0-1 float, per
 * types/analysis.ts) into a whole-number percentage. Do NOT use this on
 * AnalysisResult.final_result.ai_probability — lib/analysis/aggregator.ts
 * already returns that as a clamped 0-100 integer, and this function's
 * score<=1 heuristic can't tell "a provider score of exactly 1.0 (100%)"
 * apart from "an aggregate ai_probability of exactly 1 (1%)": both hit the
 * same branch and get multiplied by 100, inverting the 1% case to 100%. Use
 * clampPercent() for values that are already a percentage.
 */
export function toPercentageScore(score: number | undefined | null): number {
  if (score === undefined || score === null || Number.isNaN(score)) return 0;
  if (score <= 1) return Math.round(score * 100);
  return Math.round(Math.min(score, 100));
}

/** For values already expressed 0-100 (e.g. final_result.ai_probability) —
 *  no magnitude-based guessing, just clamps and rounds. */
export function clampPercent(value: number | undefined | null): number {
  if (value === undefined || value === null || Number.isNaN(value)) return 0;
  return Math.round(Math.max(0, Math.min(100, value)));
}

export function getScoreLabel(score: number): string {
  if (score >= 80) return "AI 생성물 가능성 높음";
  if (score >= 60) return "AI 생성 의심";
  if (score >= 31) return "판단 불확실";
  return "실제 이미지 가능성 높음";
}

// Dark-theme tokens (2026-08-01 design handoff) — shade depth still conveys
// confidence (high = brightest/most opaque), not a red/amber/blue semantic
// color, since "confidence" isn't a danger signal the way the score's
// tone (ScoreGauge.tsx) is.
export function getConfidenceTone(confidence: "low" | "medium" | "high"): string {
  if (confidence === "high") return "border-white/20 bg-white/20 text-[#f4f4f6]";
  if (confidence === "medium") return "border-white/12 bg-white/10 text-[#e5e5ea]";
  return "border-white/8 bg-transparent text-[#9a9aa4]";
}
