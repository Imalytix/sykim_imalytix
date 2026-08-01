"use client";

import { ChevronDown, Check } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import ErrorState from "@/components/results/ErrorState";
import FeedbackForm from "@/components/results/FeedbackForm";
import ImageCanvasWithBoxes from "@/components/results/ImageCanvasWithBoxes";
import MetadataResultCard from "@/components/results/MetadataResultCard";
import ProviderResultCard from "@/components/results/ProviderResultCard";
import RecommendationPanel from "@/components/results/RecommendationPanel";
import RegionDetailPanel from "@/components/results/RegionDetailPanel";
import ScoreGauge from "@/components/results/ScoreGauge";
import SuspiciousRegionList from "@/components/results/SuspiciousRegionList";
import type { AnalysisResult, VisionResult } from "@/types/analysis";
import { clampPercent } from "@/lib/utils/score";

/** "핵심 결과" row — icon-circle + title/sub. */
function KeyFindingRow({ ok, title, sub }: { ok: boolean; title: string; sub: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3.5">
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          ok ? "bg-[#4ade80]/20 text-[#86efac]" : "bg-amber-400/20 text-amber-300"
        }`}
      >
        {ok ? <Check className="h-4 w-4" /> : <span className="text-[15px] font-bold">!</span>}
      </div>
      <div className="flex flex-col gap-0.5">
        <div className="text-sm font-semibold tracking-tight text-[#f4f4f6]">{title}</div>
        <div className="text-xs leading-snug text-[#9a9aa4]">{sub}</div>
      </div>
    </div>
  );
}

interface AnalysisResultViewProps {
  analysisResult: AnalysisResult;
  previewUrl: string | null;
  errorMessage?: string | null;
  /** Live analyze flow only — omit to hide the "새 이미지 분석" reset button. */
  onReset?: () => void;
  /** History detail page only — omit to hide the "목록으로" back link. */
  backHref?: string;
}

export default function AnalysisResultView({ analysisResult, previewUrl, errorMessage, onReset, backHref }: AnalysisResultViewProps) {
  const [showDetail, setShowDetail] = useState(false);
  const [selectedRegionIndex, setSelectedRegionIndex] = useState(0);
  const detailRef = useRef<HTMLDivElement | null>(null);

  const visionResults = analysisResult.vision_results ?? [];
  const metadata = analysisResult.metadata_analysis;
  const suspiciousRegions = analysisResult.suspicious_regions ?? [];
  const scorePercent = clampPercent(analysisResult.final_result.ai_probability);
  const allProvidersFailed = visionResults.length > 0 && visionResults.every((v) => v.error_message);

  const duplicateCheck = analysisResult.duplicate_check;
  const duplicateMatches = duplicateCheck?.matches ?? [];
  const closestMatch = duplicateMatches[0];
  const keyFindings = [
    {
      ok: Boolean(metadata?.exif_found),
      title: metadata?.exif_found ? "촬영 정보가 확인되었습니다." : "촬영 정보를 확인할 수 없습니다.",
      sub: metadata?.exif_found ? "카메라로 촬영된 기록이 남아 있습니다." : "EXIF·촬영 기록이 이미지에 남아 있지 않습니다.",
    },
    {
      ok: Boolean(metadata?.c2pa_found),
      title: metadata?.c2pa_found ? "제작 이력이 확인되었습니다." : "제작 이력을 확인할 수 없습니다.",
      sub: metadata?.c2pa_found
        ? "Content Credentials(C2PA) 서명이 포함되어 있습니다."
        : "제작·편집 기록(C2PA)이 이미지에 남아 있지 않습니다.",
    },
    duplicateCheck?.used_cached_result && closestMatch
      ? {
          ok: true,
          title: "동일한 이미지를 이전에 분석한 적이 있습니다.",
          sub: `요청 ID ${closestMatch.request_id}의 판정을 그대로 사용했습니다 (LLM 재호출 생략) — 그때 판정: ${
            closestMatch.is_ai_generated ? "AI 생성" : "실제 이미지"
          }.`,
        }
      : duplicateCheck?.influenced_score && closestMatch
        ? {
            ok: false,
            title: `유사한 이미지 ${duplicateMatches.length}건이 발견되어 결과에 반영되었습니다.`,
            sub: `가장 유사한 요청 ID ${closestMatch.request_id}(픽셀 유사)의 판정(${
              closestMatch.is_ai_generated ? "AI 생성" : "실제 이미지"
            })이 이번 점수에 영향을 주었습니다.`,
          }
        : {
            ok: duplicateMatches.length === 0,
            title: duplicateMatches.length === 0 ? "웹에서 동일한 이미지가 발견되지 않았습니다." : `유사한 이미지 ${duplicateMatches.length}건이 발견되었습니다.`,
            sub:
              duplicateMatches.length === 0
                ? "이전에 분석한 이미지 중 일치하는 항목이 없습니다."
                : "유사도가 낮아 이번 결과에는 반영되지 않았습니다.",
          },
  ];

  return (
    <>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          {backHref && (
            <Link href={backHref} className="mb-1 inline-block text-xs font-medium text-[#9a9aa4] hover:text-[#f4f4f6]">
              ← 목록으로
            </Link>
          )}
          <h2 className="text-xl font-bold text-[#f4f4f6]">분석 결과</h2>
          <p className="mt-0.5 text-sm text-[#9a9aa4]">
            {analysisResult.final_result.label} · AI 생성 가능성 {scorePercent}%
          </p>
        </div>
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            className="rounded-[14px] border border-white/14 bg-white/8 px-4 py-2 text-sm font-medium text-[#f4f4f6] transition hover:bg-white/16"
          >
            새 이미지 분석
          </button>
        )}
      </div>

      {errorMessage && <ErrorState message={errorMessage} />}

      <div className="mx-auto flex max-w-xl flex-col gap-4">
        {allProvidersFailed && (
          <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 px-5 py-4 text-sm text-amber-200">
            <span className="font-semibold">모든 비전 모델 호출이 실패했습니다.</span> 아래 결과는 메타데이터 분석만 반영된 값입니다. 각 카드에서
            실패 원인을 확인해주세요.
          </div>
        )}

        {previewUrl && (
          <div className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.03] p-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element -- data:/signed URL, next/image adds no value here */}
            <img src={previewUrl} alt="분석 대상 이미지" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
            <div className="flex flex-col gap-0.5">
              <div className="text-[13px] font-semibold text-[#f4f4f6]">이 이미지를 분석했습니다</div>
              <div className="text-xs text-[#9a9aa4]">
                {analysisResult.input.width}×{analysisResult.input.height} · {analysisResult.input.mime_type}
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col items-center rounded-2xl border border-white/9 bg-white/[0.04] p-7">
          <ScoreGauge score={scorePercent} label={analysisResult.final_result.label} size={180} />
          <p className="mt-4 text-center text-sm leading-6 text-[#9a9aa4]">{analysisResult.recommended_action}</p>
        </div>

        <div className="flex flex-col gap-2">
          <p className="px-1 text-xs font-semibold uppercase tracking-[0.2em] text-[#6b6b76]">핵심 결과</p>
          {keyFindings.map((f, i) => (
            <KeyFindingRow key={i} ok={f.ok} title={f.title} sub={f.sub} />
          ))}
        </div>

        {analysisResult.evidence_summary.length > 0 && (
          <div className="rounded-2xl border border-white/9 bg-white/[0.04] p-5">
            <p className="mb-3 text-[15px] font-bold text-[#f4f4f6]">왜 이렇게 판단했나요?</p>
            <ul className="flex flex-col gap-2">
              {analysisResult.evidence_summary.slice(0, 6).map((reason, i) => (
                <li key={i} className="flex items-start gap-2.5 text-[13.5px] leading-6 text-[#d4d4d9]">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#6b6b76]" />
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <RecommendationPanel
          recommendedAction={analysisResult.recommended_action}
          limitations={analysisResult.limitations ?? []}
          aiProbability={scorePercent}
        />

        <button
          type="button"
          onClick={() => {
            const next = !showDetail;
            setShowDetail(next);
            if (next) requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
          }}
          aria-expanded={showDetail}
          className="flex items-center justify-center gap-2 rounded-xl border border-white/14 bg-white/8 py-3.5 text-sm font-bold text-[#f4f4f6] transition hover:bg-white/16"
        >
          {showDetail ? "분석 접기" : "자세한 분석 보기"}
          <ChevronDown className={`h-4 w-4 transition-transform ${showDetail ? "rotate-180" : ""}`} />
        </button>

        {showDetail && (
          <div ref={detailRef} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 border-t border-white/8 pt-6">
              <p className="px-1 text-xs font-semibold uppercase tracking-[0.2em] text-[#6b6b76]">상세 분석 — 비전 모델</p>
              {visionResults.length > 0 ? (
                visionResults.map((item: VisionResult, i) => (
                  <ProviderResultCard
                    key={`${item.provider}-${i}`}
                    provider={item.provider}
                    modelName={item.model_name}
                    score={item.score}
                    isAiGenerated={item.is_ai_generated}
                    confidence={item.confidence}
                    evidence={item.evidence.map((e) => e.description)}
                    limitations={item.limitations}
                    errorMessage={item.error_message}
                    latencyMs={item.latency_ms}
                    usage={item.usage}
                  />
                ))
              ) : (
                <div className="rounded-xl border border-white/8 bg-white/[0.03] p-6 text-sm text-[#9a9aa4]">표시할 비전 모델 결과가 없습니다.</div>
              )}
            </div>

            {previewUrl && suspiciousRegions.length > 0 && (
              <div className="rounded-2xl border border-white/9 bg-white/[0.04] p-5">
                <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-[#6b6b76]">의심 부위 ({suspiciousRegions.length})</p>
                <div className="flex flex-col gap-4">
                  <ImageCanvasWithBoxes
                    imageUrl={previewUrl}
                    regions={suspiciousRegions}
                    selectedIndex={selectedRegionIndex}
                    onSelectRegion={setSelectedRegionIndex}
                  />
                  <RegionDetailPanel region={suspiciousRegions[selectedRegionIndex]} regionIndex={selectedRegionIndex} />
                  <SuspiciousRegionList regions={suspiciousRegions} selectedIndex={selectedRegionIndex} onSelectRegion={setSelectedRegionIndex} />
                </div>
              </div>
            )}

            <MetadataResultCard
              exifFound={Boolean(metadata?.exif_found)}
              pngMetadataFound={Boolean(metadata?.png_metadata_found)}
              c2paFound={Boolean(metadata?.c2pa_found)}
              aiToolDetected={Boolean(metadata?.ai_tool_detected)}
              detectedTools={metadata?.detected_tools ?? []}
              metadataScore={metadata?.metadata_score ?? 0}
              evidence={metadata?.evidence ?? []}
              limitations={metadata?.limitations ?? []}
              cameraInfo={metadata?.camera_info ?? null}
              fileInfo={
                metadata?.file_info ?? {
                  format: analysisResult.input.mime_type,
                  width: analysisResult.input.width,
                  height: analysisResult.input.height,
                  size_bytes: 0,
                  color_space: null,
                }
              }
            />
          </div>
        )}

        <FeedbackForm requestId={analysisResult.request_id} />
      </div>
    </>
  );
}
