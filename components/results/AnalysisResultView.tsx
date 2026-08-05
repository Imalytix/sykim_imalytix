"use client";

import { ChevronDown, ChevronLeft, Check } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import ErrorState from "@/components/results/ErrorState";
import FeedbackForm from "@/components/results/FeedbackForm";
import RecommendationPanel from "@/components/results/RecommendationPanel";
import ScoreGauge from "@/components/results/ScoreGauge";
import { createSupabaseBrowserClient } from "@/lib/supabase/browserClient";
import type { AnalysisResult } from "@/types/analysis";
import { isValidBBox } from "@/lib/utils/bbox";
import { clampPercent } from "@/lib/utils/score";

const PROVIDER_DISPLAY_NAMES: Record<string, string> = { openai: "OpenAI", gemini: "Gemini", claude: "Claude" };

/** "핵심 결과" row — icon-circle + title/sub (inside the white card, light). */
function KeyFindingRow({ ok, title, sub }: { ok: boolean; title: string; sub: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-black/6 bg-black/[0.02] px-4 py-3">
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          ok ? "bg-[#52bdff]/15 text-[#1a8fdb]" : "bg-black/8 text-[#6a6a6a]"
        }`}
      >
        {ok ? <Check className="h-4 w-4" /> : <span className="text-sm font-bold">✕</span>}
      </div>
      <div className="flex flex-col gap-0.5">
        <div className="text-[13.5px] font-semibold tracking-tight text-[#1a1a1a]">{title}</div>
        <div className="text-xs leading-snug text-[#7a7a7a]">{sub}</div>
      </div>
    </div>
  );
}

/** label-left/value-right row — the "종합 점수 / 42/100" style spec row used
 *  throughout the design handoff's detail accordions. */
function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <span className="text-[13px] text-[#7a7a7a]">{label}</span>
      <span className="text-[13px] font-bold text-[#1a1a1a]">{value}</span>
    </div>
  );
}

/** One collapsible section inside the "자세한 분석" panel — light-styled to
 *  match the design handoff (white bg, dark text), independently expandable. */
function AccordionRow({ title, subtitle, defaultOpen = false, children }: { title: string; subtitle: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-black/8">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left">
        <div>
          <div className="text-[14px] font-bold text-[#1a1a1a]">{title}</div>
          <div className="text-xs text-[#8a8a8a]">{subtitle}</div>
        </div>
        <ChevronDown className={`h-4 w-4 shrink-0 text-[#8a8a8a] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="flex flex-col border-t border-black/6 px-4 py-3">{children}</div>}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCapturedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

interface AnalysisResultViewProps {
  analysisResult: AnalysisResult;
  previewUrl: string | null;
  errorMessage?: string | null;
  /** Live analyze flow only — omit to hide the "새 이미지 분석" reset button. */
  onReset?: () => void;
  /** History detail page only — omit to hide the "목록으로" back link. */
  backHref?: string;
  /** Where the login redirect lands the browser back on — see handleDetailClick. */
  returnPath: string;
}

export default function AnalysisResultView({ analysisResult, previewUrl, errorMessage, onReset, backHref, returnPath }: AnalysisResultViewProps) {
  const [showDetail, setShowDetail] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [loginPending, setLoginPending] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data }) => setIsLoggedIn(Boolean(data.user)));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => setIsLoggedIn(Boolean(session?.user)));
    return () => subscription.unsubscribe();
  }, []);

  const visionResults = analysisResult.vision_results ?? [];
  const metadata = analysisResult.metadata_analysis;
  const camera = metadata?.camera_info ?? null;
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
          sub: `요청 ID ${closestMatch.request_id}의 판정을 그대로 사용했습니다 — 그때 판정: ${closestMatch.is_ai_generated ? "AI 생성" : "실제 이미지"}.`,
        }
      : duplicateCheck?.influenced_score && closestMatch
        ? {
            ok: false,
            title: `유사한 이미지 ${duplicateMatches.length}건이 발견되어 결과에 반영되었습니다.`,
            sub: `가장 유사한 요청 ID ${closestMatch.request_id}의 판정(${closestMatch.is_ai_generated ? "AI 생성" : "실제 이미지"})이 이번 점수에 영향을 주었습니다.`,
          }
        : {
            ok: duplicateMatches.length === 0,
            title: duplicateMatches.length === 0 ? "웹에서 동일한 이미지가 발견되지 않았습니다." : `유사한 이미지 ${duplicateMatches.length}건이 발견되었습니다.`,
            sub: duplicateMatches.length === 0 ? "이전에 분석한 이미지 중 일치하는 항목이 없습니다." : "유사도가 낮아 이번 결과에는 반영되지 않았습니다.",
          },
  ];

  const handleDetailClick = async () => {
    if (isLoggedIn) {
      setShowDetail(true);
      return;
    }
    setLoginPending(true);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(returnPath)}` },
    });
    if (error) {
      setLoginPending(false);
      alert(`로그인을 시작할 수 없습니다: ${error.message}`);
    }
    // 성공하면 브라우저가 완전히 떠나므로 이 아래는 실행되지 않음 — OAuth 왕복 후
    // returnPath로 돌아와 이 결과가 그대로 재구성됨(props 주석 참고).
  };

  const resetHref = onReset ? undefined : "/";

  return (
    <>
      {backHref && (
        <Link href={backHref} className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-[#9a9aa4] hover:text-[#f4f4f6]">
          <ChevronLeft className="h-3.5 w-3.5" /> 목록으로
        </Link>
      )}

      {errorMessage && <ErrorState message={errorMessage} />}

      <div className="mx-auto max-w-4xl">
        {allProvidersFailed && (
          <div className="mb-4 rounded-xl border border-amber-400/25 bg-amber-400/10 px-5 py-4 text-sm text-amber-200">
            <span className="font-semibold">모든 비전 모델 호출이 실패했습니다.</span> 아래 결과는 메타데이터 분석만 반영된 값입니다.
          </div>
        )}

        {/* 결과 카드 — 디자인 목업 기준 흰 카드(다크 페이지 위) */}
        <div className="overflow-hidden rounded-3xl bg-white p-6 shadow-2xl sm:p-7">
          <div className="flex flex-col gap-6 md:flex-row">
            {/* 좌측: 이미지 + 의심 부위 오버레이 */}
            <div className="shrink-0 md:w-[300px]">
              <div className="relative overflow-hidden rounded-2xl bg-[#f2f2f2]">
                {previewUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- data:/signed URL, next/image adds no value here
                  <img src={previewUrl} alt="분석 대상 이미지" className="block w-full" />
                )}
                {previewUrl &&
                  suspiciousRegions.map((region, i) =>
                    isValidBBox(region.bbox) ? (
                      <div
                        key={i}
                        className="absolute rounded-md border-2 border-[#f23e3e]"
                        style={{
                          left: `${region.bbox.x1 * 100}%`,
                          top: `${region.bbox.y1 * 100}%`,
                          width: `${(region.bbox.x2 - region.bbox.x1) * 100}%`,
                          height: `${(region.bbox.y2 - region.bbox.y1) * 100}%`,
                        }}
                      />
                    ) : null,
                  )}
              </div>
              <p className="mt-2.5 text-center text-[13px] text-[#8a8a8a]">
                {analysisResult.input.width}×{analysisResult.input.height} · {analysisResult.input.mime_type}
              </p>
            </div>

            {/* 우측: 요약 또는 자세한 분석 */}
            <div className="min-w-0 flex-1">
              {!showDetail ? (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col items-center">
                    <ScoreGauge score={scorePercent} size={150} />
                    <p className="mt-3 text-center text-sm leading-6 text-[#4a4a4a]">{analysisResult.final_result.label}</p>
                  </div>

                  <div className="flex flex-col gap-2">
                    <p className="text-[13px] font-bold text-[#1a1a1a]">핵심 결과</p>
                    {keyFindings.map((f, i) => (
                      <KeyFindingRow key={i} ok={f.ok} title={f.title} sub={f.sub} />
                    ))}
                  </div>

                  <RecommendationPanel recommendedAction={analysisResult.recommended_action} />

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={handleDetailClick}
                      disabled={loginPending}
                      className="flex-1 rounded-xl border border-[#1a1a1a]/15 bg-white py-3 text-sm font-bold text-[#1a1a1a] transition hover:bg-black/5 disabled:opacity-60"
                    >
                      {loginPending ? "이동 중…" : "자세한 분석 보기"}
                    </button>
                    {onReset ? (
                      <button
                        type="button"
                        onClick={onReset}
                        className="flex-1 rounded-xl bg-[#52bdff] py-3 text-sm font-bold text-white transition hover:opacity-90"
                      >
                        다른 이미지 확인하기
                      </button>
                    ) : (
                      <Link
                        href={resetHref ?? "/"}
                        className="flex-1 rounded-xl bg-[#52bdff] py-3 text-center text-sm font-bold text-white transition hover:opacity-90"
                      >
                        다른 이미지 확인하기
                      </Link>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <button type="button" onClick={() => setShowDetail(false)} className="flex items-center gap-1.5 text-[15px] font-bold text-[#1a1a1a]">
                    <ChevronLeft className="h-4 w-4" /> 자세한 분석
                  </button>

                  <AccordionRow title="AI 생성 분석" subtitle="질감 · 패턴 · 경계 검사" defaultOpen>
                    <SpecRow label="종합 점수" value={`${scorePercent} / 100`} />
                    {visionResults
                      .filter((v) => !v.error_message)
                      .map((v, i) => (
                        <SpecRow
                          key={i}
                          label={PROVIDER_DISPLAY_NAMES[v.provider] ?? v.provider}
                          value={`${v.is_ai_generated === true ? "AI 생성 의심" : v.is_ai_generated === false ? "실제 이미지" : "판단 불확실"} (${Math.round((v.score <= 1 ? v.score * 100 : v.score))}%)`}
                        />
                      ))}
                    {suspiciousRegions.length > 0 && <SpecRow label="의심 영역" value={`${suspiciousRegions.length}건 발견`} />}
                    <p className="mt-2 border-t border-black/6 pt-2 text-xs leading-5 text-[#8a8a8a]">
                      여러 검출 모델의 결과를 종합한 점수이며, 단독으로 진위를 판정하지 않습니다.
                    </p>
                  </AccordionRow>

                  <AccordionRow title="촬영 정보 (EXIF)" subtitle="카메라 · 촬영 조건">
                    {camera ? (
                      <>
                        {(camera.make || camera.model) && <SpecRow label="카메라" value={[camera.make, camera.model].filter(Boolean).join(" ")} />}
                        {camera.captured_at && <SpecRow label="촬영 일시" value={formatCapturedAt(camera.captured_at)} />}
                        {(camera.exposure_time || camera.f_number || camera.iso) && (
                          <SpecRow
                            label="노출"
                            value={[camera.exposure_time, camera.f_number, camera.iso ? `ISO ${camera.iso}` : null].filter(Boolean).join(" · ")}
                          />
                        )}
                        <SpecRow label="위치 정보" value={camera.has_gps ? "포함" : "미포함"} />
                      </>
                    ) : (
                      <SpecRow label="EXIF" value="확인 불가" />
                    )}
                    <p className="mt-2 border-t border-black/6 pt-2 text-xs leading-5 text-[#8a8a8a]">
                      EXIF는 촬영 기기가 이미지에 남기는 기록으로, 편집 과정에서 삭제될 수 있습니다.
                    </p>
                  </AccordionRow>

                  <AccordionRow title="콘텐츠 제작 이력 (C2PA)" subtitle="제작 · 편집 이력">
                    <SpecRow label="서명 상태" value={metadata?.c2pa_found ? "서명 있음" : "서명 없음"} />
                    <SpecRow label="편집 이력" value="확인 불가" />
                    <SpecRow label="발급 기관" value="—" />
                    <p className="mt-2 border-t border-black/6 pt-2 text-xs leading-5 text-[#8a8a8a]">
                      C2PA는 제작·편집 이력을 암호학적으로 서명하는 국제 표준입니다. 서명이 없다는 것이 AI 생성을 의미하지는 않습니다.
                    </p>
                  </AccordionRow>

                  <AccordionRow title="이미지 메타데이터" subtitle="파일 기본 정보">
                    <SpecRow label="파일 형식" value={(metadata?.file_info.format ?? analysisResult.input.mime_type ?? "알 수 없음").toUpperCase()} />
                    <SpecRow label="해상도" value={`${analysisResult.input.width} × ${analysisResult.input.height}`} />
                    {Boolean(metadata?.file_info.size_bytes) && <SpecRow label="용량" value={formatBytes(metadata!.file_info.size_bytes)} />}
                    {metadata?.file_info.color_space && <SpecRow label="색 공간" value={metadata.file_info.color_space} />}
                  </AccordionRow>

                  <AccordionRow title="유사 이미지 검색" subtitle="DB 내 이미지 역탐지">
                    <SpecRow label="동일 이미지" value={`${duplicateCheck?.used_cached_result ? 1 : 0}건`} />
                    <SpecRow label="유사 이미지" value={`${duplicateMatches.length}건`} />
                    <SpecRow label="최초 게시 추정" value="확인 불가" />
                    <p className="mt-2 border-t border-black/6 pt-2 text-xs leading-5 text-[#8a8a8a]">
                      Imalytix에 이전에 분석 이력이 있는 이미지만 대상으로 합니다.
                    </p>
                  </AccordionRow>

                  <p className="text-center text-xs leading-5 text-[#8a8a8a]">Imalytix의 분석은 판단을 돕기 위한 참고 정보이며, 정확하지 않을 수 있습니다.</p>

                  {onReset ? (
                    <button type="button" onClick={onReset} className="rounded-xl bg-[#52bdff] py-3 text-sm font-bold text-white transition hover:opacity-90">
                      다른 이미지 확인하기
                    </button>
                  ) : (
                    <Link href="/" className="rounded-xl bg-[#52bdff] py-3 text-center text-sm font-bold text-white transition hover:opacity-90">
                      다른 이미지 확인하기
                    </Link>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <p className="mt-6 text-center text-sm leading-6 text-[#9a9aa4]">
          Imalytix는 확률을 기반으로 결과를 제공합니다. 탐지 결과가 완벽하지 않을 수 있으니, 최종 판단은 신중히 내려 주시기 바랍니다.
        </p>

        <FeedbackForm requestId={analysisResult.request_id} />
      </div>
    </>
  );
}
