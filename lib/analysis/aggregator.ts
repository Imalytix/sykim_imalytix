import type { FinalResult, MetadataAnalysis, SuspiciousRegion, VisionResult } from "@/types/analysis";

const CONFIDENCE_WEIGHTS: Record<string, number> = { high: 1.0, medium: 0.7, low: 0.4 };
const VISUAL_EVIDENCE_POINTS: Record<string, number> = { high: 5, medium: 3, low: 1 };

const FINAL_LABELS: Array<[threshold: number, label: string, isAiGenerated: boolean | null, confidence: FinalResult["confidence"]]> = [
  [80, "AI 생성 가능성 높음", true, "high"],
  [60, "AI 생성 의심", true, "medium"],
  [31, "판단 불확실", null, "low"],
  [0, "실제 이미지 가능성 높음", false, "medium"],
];

function labelFromScore(score: number): [string, boolean | null, FinalResult["confidence"]] {
  for (const [threshold, label, isAiGenerated, confidence] of FINAL_LABELS) {
    if (score >= threshold) return [label, isAiGenerated, confidence];
  }
  return ["실제 이미지 가능성 높음", false, "medium"];
}

export function makeRecommendation(score: number): string {
  if (score >= 80) return "AI 생성 이미지일 가능성이 높으므로 실제 사진처럼 공유하기 전 출처 확인이 필요합니다.";
  if (score >= 60) return "AI 생성 의심 이미지입니다. 원본 출처와 추가 정보를 확인하는 것이 좋습니다.";
  if (score >= 31) return "판단이 불확실합니다. 원본 파일, 출처, 추가 맥락 확인이 필요합니다.";
  return "현재 분석 기준으로는 실제 이미지 가능성이 높습니다.";
}

function visionMultiplier(avgScore: number, confidence: string, activeSignals: number): number {
  let base = activeSignals === 1 ? 65.0 : 48.0;
  if (confidence === "high" && avgScore >= 0.8) base *= 1.25;
  else if (confidence === "high" && avgScore >= 0.6) base *= 1.1;
  return base;
}

export interface AggregateResult {
  final_result: FinalResult;
  evidence_summary: string[];
  suspicious_regions: SuspiciousRegion[];
  limitations: string[];
  recommended_action: string;
}

export function aggregateAnalysis(
  metadataResult: MetadataAnalysis,
  visionResults: VisionResult[],
): AggregateResult {
  let finalScore = 0;
  const evidenceSummary: string[] = [];
  const suspiciousRegions: SuspiciousRegion[] = [];
  const limitations: string[] = [];

  // 1. 메타데이터
  const metadataScore = metadataResult.metadata_score || 0;
  finalScore += metadataScore;
  evidenceSummary.push(...metadataResult.evidence.filter(Boolean));
  limitations.push(...metadataResult.limitations.filter(Boolean));

  // 2. 비전 모델
  const hasMetadata = metadataScore > 0;
  const validVision = visionResults.filter((r) => !r.is_mock);
  const hasVision = validVision.length > 0;
  const activeSignals = [hasMetadata, hasVision].filter(Boolean).length;

  const weightedScores: Array<[score: number, confidence: string, weight: number]> = [];
  let visualScore = 0;
  let dominantConfidence = "low";

  for (const result of validVision) {
    const score = Math.max(0, Math.min(1, result.score ?? 0.5));
    const confidence = result.confidence ?? "low";
    const weight = CONFIDENCE_WEIGHTS[confidence] ?? 0.4;
    weightedScores.push([score, confidence, weight]);

    if (confidence === "high") dominantConfidence = "high";
    else if (confidence === "medium" && dominantConfidence !== "high") dominantConfidence = "medium";

    for (const item of result.evidence) {
      if (item.description) evidenceSummary.push(item.description);
      visualScore += VISUAL_EVIDENCE_POINTS[item.severity ?? "low"] ?? 1;
    }

    suspiciousRegions.push(...result.suspicious_regions.filter(Boolean));
    limitations.push(...result.limitations.filter(Boolean));
  }

  if (weightedScores.length > 0) {
    const totalWeight = weightedScores.reduce((sum, [, , w]) => sum + w, 0);
    const avgVisionScore = totalWeight
      ? weightedScores.reduce((sum, [s, , w]) => sum + s * w, 0) / totalWeight
      : 0;

    const multiplier = visionMultiplier(avgVisionScore, dominantConfidence, activeSignals);
    finalScore += avgVisionScore * multiplier;

    // 모델 합의 보너스
    const allScores = weightedScores.map(([s]) => s);
    const aiAgreeScore = allScores.filter((s) => s >= 0.5).length;
    const aiAgreeVerdict = validVision.filter((r) => r.is_ai_generated === true).length;
    const aiAgree = Math.max(aiAgreeScore, aiAgreeVerdict);
    const realAgree = allScores.filter((s) => s <= 0.3).length;

    if (aiAgree >= 2) finalScore += 10 * aiAgree;
    else if (realAgree >= 2) finalScore -= 8;
  }

  // 3. 시각 근거 보너스 (최대 25점)
  finalScore += Math.min(visualScore, 25);

  finalScore = Math.max(0, Math.min(100, Math.round(finalScore)));
  const [label, isAiGenerated, confidenceLevel] = labelFromScore(finalScore);

  return {
    final_result: {
      is_ai_generated: isAiGenerated,
      ai_probability: finalScore,
      label,
      confidence: confidenceLevel,
    },
    evidence_summary: evidenceSummary.slice(0, 10),
    suspicious_regions: suspiciousRegions.slice(0, 10),
    limitations: [...new Set(limitations)],
    recommended_action: makeRecommendation(finalScore),
  };
}
