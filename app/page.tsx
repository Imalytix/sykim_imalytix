"use client";

import { Check, FileSearch, Link2, ScanSearch, ShieldCheck, Upload } from "lucide-react";
import { useState } from "react";
import AnalysisStepsLoader from "@/components/results/AnalysisStepsLoader";
import ErrorState from "@/components/results/ErrorState";
import AppHeader from "@/components/layout/AppHeader";
import ImageCanvasWithBoxes from "@/components/results/ImageCanvasWithBoxes";
import MetadataResultCard from "@/components/results/MetadataResultCard";
import ProviderResultCard from "@/components/results/ProviderResultCard";
import RecommendationPanel from "@/components/results/RecommendationPanel";
import RegionDetailPanel from "@/components/results/RegionDetailPanel";
import ScoreGauge from "@/components/results/ScoreGauge";
import SuspiciousRegionList from "@/components/results/SuspiciousRegionList";
import ImageUploader from "@/components/upload/ImageUploader";
import type { AnalysisResult, VisionResult } from "@/types/analysis";
import { clampPercent } from "@/lib/utils/score";

type InputMode = "file" | "url";

const USE_CASES = [
  {
    icon: <ShieldCheck className="h-5 w-5 text-[#9a9aa4]" />,
    title: "중고거래 이미지 검증",
    desc: "판매 상품 사진이 실제 촬영인지, AI로 만든 가짜인지 확인합니다.",
  },
  {
    icon: <ScanSearch className="h-5 w-5 text-[#9a9aa4]" />,
    title: "SNS 딥페이크 탐지",
    desc: "소셜 미디어의 의심스러운 프로필·사건 사진의 진위를 판별합니다.",
  },
  {
    icon: <FileSearch className="h-5 w-5 text-[#9a9aa4]" />,
    title: "문서·증거 사진 확인",
    desc: "법적·계약상 증거 이미지의 편집·위변조 여부를 탐지합니다.",
  },
];

/** "핵심 결과" row — icon-circle + title/sub, adapted from the dark-theme
 *  design handoff's .findings list (imalytix-web-deploy/result.html). `ok`
 *  picks a reassuring green check vs. an attention-worthy amber "!". */
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

async function analyzeImageFile(file: File): Promise<AnalysisResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("mode", "standard");

  const response = await fetch("/api/analyze/image", { method: "POST", body: formData });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.detail ?? "분석에 실패했습니다.");
  return data as AnalysisResult;
}

async function analyzeImageUrl(imageUrl: string): Promise<AnalysisResult> {
  const response = await fetch("/api/analyze/image-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_url: imageUrl, mode: "standard" }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.detail ?? "분석에 실패했습니다.");
  return data as AnalysisResult;
}

export default function Home() {
  const [inputMode, setInputMode] = useState<InputMode>("file");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imageUrlInput, setImageUrlInput] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedRegionIndex, setSelectedRegionIndex] = useState(0);

  const visionResults = analysisResult?.vision_results ?? [];
  const metadata = analysisResult?.metadata_analysis;
  const suspiciousRegions = analysisResult?.suspicious_regions ?? [];
  const scorePercent = analysisResult ? clampPercent(analysisResult.final_result.ai_probability) : 0;
  const allProvidersFailed = visionResults.length > 0 && visionResults.every((v) => v.error_message);

  const duplicateCheck = analysisResult?.duplicate_check;
  const duplicateMatches = duplicateCheck?.matches ?? [];
  const closestMatch = duplicateMatches[0];
  const keyFindings = analysisResult
    ? [
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
                sub: `가장 유사한 요청 ID ${closestMatch.request_id}(${
                  closestMatch.match_type === "phash" ? "픽셀 유사" : "의미적 유사"
                })의 판정(${closestMatch.is_ai_generated ? "AI 생성" : "실제 이미지"})이 이번 점수에 영향을 주었습니다.`,
              }
            : {
                ok: duplicateMatches.length === 0,
                title: duplicateMatches.length === 0 ? "웹에서 동일한 이미지가 발견되지 않았습니다." : `유사한 이미지 ${duplicateMatches.length}건이 발견되었습니다.`,
                sub:
                  duplicateMatches.length === 0
                    ? "이전에 분석한 이미지 중 일치하는 항목이 없습니다."
                    : "유사도가 낮아 이번 결과에는 반영되지 않았습니다.",
              },
      ]
    : [];

  const handleAnalyze = async () => {
    try {
      setErrorMessage(null);
      setIsLoading(true);
      let result: AnalysisResult;

      if (inputMode === "url") {
        const trimmed = imageUrlInput.trim();
        if (!trimmed) {
          setErrorMessage("이미지 URL을 입력해주세요.");
          return;
        }
        result = await analyzeImageUrl(trimmed);
      } else {
        if (!selectedFile) {
          setErrorMessage("이미지를 먼저 선택해주세요.");
          return;
        }
        result = await analyzeImageFile(selectedFile);
      }

      // Always show the exact (normalized) bytes the models actually saw —
      // never the raw upload or the user-typed URL. For URL mode in
      // particular, a redirect can land on different bytes than what the
      // browser would fetch independently from the original address.
      setPreviewUrl(result.analyzed_image_data_url);
      setAnalysisResult(result);
      setSelectedRegionIndex(0);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "분석에 실패했습니다.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setAnalysisResult(null);
    setSelectedFile(null);
    setPreviewUrl(null);
    setErrorMessage(null);
    setImageUrlInput("");
  };

  const showHero = !analysisResult && !isLoading;

  return (
    <div className="min-h-screen bg-[#0a0a0c]">
      <AppHeader />

      {showHero && (
        <section className="border-b border-white/6 bg-[#0a0a0c] py-16 text-center">
          <div className="mx-auto max-w-2xl px-6">
            <span className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3.5 py-1 text-xs font-medium text-[#9a9aa4]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#3b82f6]" />
              멀티모델 AI 이미지 분석
            </span>
            <h1 className="mt-3 text-4xl font-bold tracking-tight text-[#f4f4f6] lg:text-5xl">이 이미지, 진짜일까요?</h1>
            <p className="mt-4 text-[15px] leading-relaxed text-[#9a9aa4]">
              메타데이터 분석과 시각 AI 앙상블(GPT-4o · Gemini · Claude)을 조합해
              <br className="hidden sm:block" />
              이미지의 AI 생성 여부를 판별합니다.
            </p>
          </div>
        </section>
      )}

      <main className="mx-auto w-full max-w-5xl px-6 py-10">
        {showHero && (
          <div className="mx-auto max-w-2xl">
            <div className="mb-4 flex gap-2">
              <button
                type="button"
                onClick={() => setInputMode("file")}
                className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition ${
                  inputMode === "file" ? "border-[#3b82f6] bg-[#3b82f6] text-white" : "border-white/14 bg-white/8 text-[#e5e5ea] hover:bg-white/16"
                }`}
              >
                <Upload className="h-4 w-4" />
                파일 업로드
              </button>
              <button
                type="button"
                onClick={() => setInputMode("url")}
                className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition ${
                  inputMode === "url" ? "border-[#3b82f6] bg-[#3b82f6] text-white" : "border-white/14 bg-white/8 text-[#e5e5ea] hover:bg-white/16"
                }`}
              >
                <Link2 className="h-4 w-4" />
                URL 입력
              </button>
            </div>

            {inputMode === "file" ? (
              <ImageUploader
                previewUrl={previewUrl}
                fileName={selectedFile?.name ?? null}
                onFileSelected={(file, dataUrl) => {
                  setSelectedFile(file);
                  setPreviewUrl(dataUrl);
                  setErrorMessage(null);
                }}
                onError={(message) => setErrorMessage(message)}
              />
            ) : (
              <div className="rounded-2xl border border-white/9 bg-white/[0.04] p-5">
                <label className="mb-2 block text-sm font-medium text-[#e5e5ea]">이미지 URL</label>
                <input
                  type="url"
                  placeholder="https://example.com/image.jpg"
                  value={imageUrlInput}
                  onChange={(e) => {
                    setImageUrlInput(e.target.value);
                    setErrorMessage(null);
                  }}
                  className="w-full rounded-xl border border-white/14 bg-black/20 px-4 py-3 text-sm text-[#f4f4f6] placeholder-[#6b6b76] outline-none transition focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/25"
                />
                <p className="mt-2 text-xs text-[#6b6b76]">공개적으로 접근 가능한 이미지 URL을 입력하세요.</p>
              </div>
            )}

            {errorMessage && !isLoading && (
              <div className="mt-3 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{errorMessage}</div>
            )}

            <button
              type="button"
              onClick={handleAnalyze}
              disabled={isLoading}
              className="mt-4 h-[52px] w-full rounded-[14px] bg-[#3b82f6] text-sm font-bold tracking-tight text-white shadow-[0_10px_30px_rgba(59,130,246,0.35)] transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-50"
            >
              {isLoading ? "분석 중…" : "분석 시작"}
            </button>
          </div>
        )}

        {isLoading && (
          <div className="mx-auto max-w-2xl">
            <AnalysisStepsLoader active={isLoading} />
          </div>
        )}

        {analysisResult && !isLoading && (
          <>
            <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-[#f4f4f6]">분석 결과</h2>
                <p className="mt-0.5 text-sm text-[#9a9aa4]">
                  {analysisResult.final_result.label} · AI 생성 가능성 {scorePercent}%
                </p>
              </div>
              <button
                type="button"
                onClick={handleReset}
                className="rounded-[14px] border border-white/14 bg-white/8 px-4 py-2 text-sm font-medium text-[#f4f4f6] transition hover:bg-white/16"
              >
                새 이미지 분석
              </button>
            </div>

            {errorMessage && <ErrorState message={errorMessage} />}

            {/* Single-column card stack, capped narrow — mirrors the design
                handoff's panel layout (imalytix-panel-standalone.html: preview
                → gauge → key findings → reasons → interpretation) instead of
                the previous wide two-column dashboard grid. The provider/
                metadata/region breakdown below is that design's separate
                "상세 분석" screen, kept on the same page here rather than a
                toggled view — a full web page has room to just keep scrolling. */}
            <div className="mx-auto flex max-w-xl flex-col gap-4">
              {allProvidersFailed && (
                <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 px-5 py-4 text-sm text-amber-200">
                  <span className="font-semibold">모든 비전 모델 호출이 실패했습니다.</span> 아래 결과는 메타데이터 분석만 반영된 값입니다. 각
                  카드에서 실패 원인을 확인해주세요.
                </div>
              )}

              {previewUrl && (
                <div className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.03] p-2.5">
                  {/* eslint-disable-next-line @next/next/no-img-element -- data: URL, next/image adds no value here */}
                  <img src={previewUrl} alt="분석 대상 이미지" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
                  <div className="flex flex-col gap-0.5">
                    <div className="text-[13px] font-semibold text-[#f4f4f6]">이 이미지를 분석했습니다</div>
                    <div className="text-xs text-[#9a9aa4]">{analysisResult.input.width}×{analysisResult.input.height} · {analysisResult.input.mime_type}</div>
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

              <div className="mt-2 flex flex-col gap-2 border-t border-white/8 pt-6">
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
          </>
        )}

        {showHero && (
          <section id="how-it-works" className="mt-20">
            <p className="mb-6 text-center text-xs font-semibold uppercase tracking-widest text-[#6b6b76]">이런 상황에서 사용하세요</p>
            <div className="grid gap-4 sm:grid-cols-3">
              {USE_CASES.map((uc) => (
                <div key={uc.title} className="rounded-2xl border border-white/9 bg-white/[0.03] p-6 transition hover:border-white/16 hover:bg-white/[0.06]">
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5">{uc.icon}</div>
                  <div className="text-sm font-semibold text-[#f4f4f6]">{uc.title}</div>
                  <div className="mt-1.5 text-sm leading-relaxed text-[#9a9aa4]">{uc.desc}</div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
