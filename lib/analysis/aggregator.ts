import type { FinalResult, MetadataAnalysis, SimilarImageMatch, SuspiciousRegion, VisionResult } from "@/types/analysis";

const CONFIDENCE_WEIGHTS: Record<string, number> = { high: 1.0, medium: 0.7, low: 0.4 };
const VISUAL_EVIDENCE_POINTS: Record<string, number> = { high: 5, medium: 3, low: 1 };

// 3개 모델 평균만 쓰면, 한 모델이 매우 강하게 AI로 판단해도 나머지 2개가
// 애매/실사 쪽이면 평균에 묻혀버림 — 단일 모델의 강한 신호도 최종 점수에
// 충분히 반영되도록, 그 신호를 평균과 블렌딩해 반영 비중을 높임(완전히
// 그 값으로 덮어쓰지는 않음 — 여전히 여러 모델을 종합한다는 취지는 유지).
const STRONG_AI_SCORE_THRESHOLD = 0.8;

// Smaller cap than the ±25 vision-evidence swing (below) — a similar past
// image is a weaker, indirect signal than this request's own models
// actually looking at it, so it should nudge, not dominate, the score.
const SIMILAR_IMAGE_MAX_POINTS = 15;
// pHash Hamming distance (out of 64 bits) beyond which "similar" no longer
// means much — matches this far apart barely share pixel structure.
const PHASH_MEANINGFUL_DISTANCE = 10;

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
  /** true when a similar-image match actually moved the score (see the
   *  "4. 유사 이미지" block below) — lets pipeline.ts set
   *  duplicate_check.influenced_score without re-deriving the same
   *  distance-threshold logic a second time. Always false from
   *  buildDuplicateAggregateResult (that's the used_cached_result case, a
   *  different thing). */
  used_similar_match: boolean;
}

export function aggregateAnalysis(
  metadataResult: MetadataAnalysis,
  visionResults: VisionResult[],
  /** Non-exact (pHash-loose) duplicate matches — an exact/near-exact pHash
   *  match should go through buildDuplicateAggregateResult() instead and
   *  skip this function entirely (see lib/analysis/pipeline.ts).
   *  Closest-first (find_similar_images orders by distance asc), so
   *  matches[0] is what actually gets used. */
  similarMatches: SimilarImageMatch[] = [],
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

    // Evidence severity says how *strong* a clue is, not which direction it
    // points — a model's own verdict (or its score vs. the 0.5 boundary when
    // the verdict itself is null/uncertain) supplies the direction. Without
    // this, "real"-leaning evidence from a confident model still pushed the
    // aggregate score toward "AI-generated".
    const direction = result.is_ai_generated === false ? -1 : result.is_ai_generated === true ? 1 : score >= 0.5 ? 1 : -1;
    for (const item of result.evidence) {
      if (item.description) evidenceSummary.push(item.description);
      visualScore += direction * (VISUAL_EVIDENCE_POINTS[item.severity ?? "low"] ?? 1);
    }

    suspiciousRegions.push(...result.suspicious_regions.filter(Boolean));
    limitations.push(...result.limitations.filter(Boolean));
  }

  if (weightedScores.length > 0) {
    const totalWeight = weightedScores.reduce((sum, [, , w]) => sum + w, 0);
    const avgVisionScore = totalWeight
      ? weightedScores.reduce((sum, [s, , w]) => sum + s * w, 0) / totalWeight
      : 0;

    // 신뢰도가 낮지 않은(medium/high) 모델 중 가장 강하게 "AI 같다"고 본 점수.
    // 이게 임계값을 넘으면, 평균만으로 계산했을 때보다 최종 점수에 훨씬 크게
    // 반영되도록 평균과 50:50으로 블렌딩한다 — 3개 중 1개만 확신에 찬 AI
    // 판정을 내려도 나머지 2개의 애매한 판정에 묻히지 않게 하기 위함.
    const strongAiSignal = weightedScores
      .filter(([, confidence]) => confidence !== "low")
      .reduce((max, [s]) => Math.max(max, s), 0);
    const hasStrongAiSignal = strongAiSignal >= STRONG_AI_SCORE_THRESHOLD;
    const effectiveVisionScore = hasStrongAiSignal ? (avgVisionScore + strongAiSignal) / 2 : avgVisionScore;

    const multiplier = visionMultiplier(effectiveVisionScore, dominantConfidence, activeSignals);
    finalScore += effectiveVisionScore * multiplier;

    // 모델 합의 보너스
    const allScores = weightedScores.map(([s]) => s);
    const aiAgreeScore = allScores.filter((s) => s >= 0.5).length;
    const aiAgreeVerdict = validVision.filter((r) => r.is_ai_generated === true).length;
    const aiAgree = Math.max(aiAgreeScore, aiAgreeVerdict);
    const realAgree = allScores.filter((s) => s <= 0.3).length;

    if (aiAgree >= 2) finalScore += 10 * aiAgree;
    // 강한 단일 AI 신호가 있으면, 나머지 2개가 "실제 같다"고 봤다는 이유만으로
    // 페널티를 주지 않는다 — 한 모델의 확신에 찬 AI 판정을 나머지 다수결로
    // 뒤집는 셈이 되어 이번 조정의 취지와 어긋남.
    else if (realAgree >= 2 && !hasStrongAiSignal) finalScore -= 8;
  }

  // 3. 시각 근거 보너스/페널티 (최대 ±25점 — 방향은 위 direction 참고)
  finalScore += Math.max(-25, Math.min(visualScore, 25));

  // 4. 유사 이미지 이력 보너스/페널티 (최대 ±15점) — 과거에 분석한 유사 이미지가
  // AI 생성으로 판정됐다면 이번 이미지도 AI일 가능성을 소폭 높이고, 반대도 마찬가지.
  // 가장 가까운(distance 최솟값) 매치 하나만 사용 — 여러 개를 합산하면 같은
  // 원본에서 파생된 사본들이 중복 집계되어 신호가 부풀려질 수 있음.
  const usableMatch = similarMatches.find((m) => m.is_ai_generated !== null && m.distance <= PHASH_MEANINGFUL_DISTANCE);
  if (usableMatch) {
    const closeness = 1 - usableMatch.distance / PHASH_MEANINGFUL_DISTANCE;
    const direction = usableMatch.is_ai_generated ? 1 : -1;
    finalScore += direction * closeness * SIMILAR_IMAGE_MAX_POINTS;
    evidenceSummary.push(
      `이전에 분석한 유사 이미지(픽셀 유사, 요청 ID: ${usableMatch.request_id})가 ` +
        `${usableMatch.is_ai_generated ? "AI 생성" : "실제 이미지"}로 판정되어 이번 결과에 반영되었습니다.`,
    );
  }

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
    used_similar_match: Boolean(usableMatch),
  };
}

export interface DuplicateAggregateResult {
  aggregate: AggregateResult;
  /** The matched row's own vision_results — pipeline.ts assigns this
   *  straight to AnalysisResult.vision_results so the duplicate result
   *  renders with the same provider-by-provider breakdown a fresh analysis
   *  would have, not an empty "표시할 비전 모델 결과가 없습니다" section. */
  visionResults: VisionResult[];
}

/**
 * Used instead of aggregateAnalysis() when pipeline.ts finds a near-exact
 * pHash duplicate with a usable cached result (see EXACT_DUPLICATE_PHASH_
 * DISTANCE there) — reuses that earlier image's full result (score,
 * per-provider breakdown, evidence, suspicious regions) wholesale rather
 * than running the vision models again, since re-analyzing pixel-identical
 * bytes would just spend API budget to (almost certainly) reproduce the
 * same answer. The result should look like a complete analysis, not a
 * stripped-down summary — only the "이전에 분석한 동일 이미지" note at the
 * top of evidence_summary distinguishes it.
 */
export function buildDuplicateAggregateResult(match: SimilarImageMatch): DuplicateAggregateResult {
  const score = match.ai_probability !== null ? Math.round(Math.max(0, Math.min(100, match.ai_probability))) : 50;
  const [label, isAiGenerated, confidenceLevel] = labelFromScore(score);
  const cached = match.full_result;
  const analyzedDate = new Date(match.created_at).toLocaleDateString("ko-KR");
  const note = `이전에 분석한 동일 이미지(요청 ID: ${match.request_id}, ${analyzedDate} 분석)의 결과를 그대로 표시합니다 — 재분석하지 않았습니다.`;

  return {
    visionResults: cached?.vision_results ?? [],
    aggregate: {
      final_result: { is_ai_generated: isAiGenerated, ai_probability: score, label, confidence: confidenceLevel },
      evidence_summary: [note, ...(cached?.evidence_summary ?? [])].slice(0, 10),
      suspicious_regions: cached?.suspicious_regions ?? [],
      limitations: ["이 결과는 새로 분석되지 않고, 이전에 분석한 동일 이미지의 판정을 재사용한 것입니다."],
      recommended_action: makeRecommendation(score),
      used_similar_match: false,
    },
  };
}
