"use client";

import { ChevronDown, ChevronLeft, Check } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import ErrorState from "@/components/results/ErrorState";
import FeedbackForm from "@/components/results/FeedbackForm";
import RecommendationPanel from "@/components/results/RecommendationPanel";
import ScoreGauge, { toneForScore } from "@/components/results/ScoreGauge";
import { createSupabaseBrowserClient } from "@/lib/supabase/browserClient";
import { localized, useLanguage, type Locale } from "@/components/layout/LanguageProvider";
import type { AnalysisResult } from "@/types/analysis";
import { isValidBBox } from "@/lib/utils/bbox";
import { trackEvidenceExpand, type EvidenceType } from "@/lib/analytics/gtag";
import { clampPercent } from "@/lib/utils/score";

const PROVIDER_DISPLAY_NAMES: Record<string, string> = { openai: "OpenAI", gemini: "Gemini", claude: "Claude" };

function severityConfig(locale: Locale): Record<string, { label: string; badge: string; dot: string }> {
  return {
    high: { label: localized(locale, "위험도 높음", "High risk"), badge: "bg-[#f23e3e]/10 text-[#c81e1e]", dot: "bg-[#f23e3e]" },
    medium: { label: localized(locale, "위험도 보통", "Medium risk"), badge: "bg-[#ffca1a]/15 text-[#8a6400]", dot: "bg-[#ffca1a]" },
    low: { label: localized(locale, "위험도 낮음", "Low risk"), badge: "bg-[#52bdff]/10 text-[#1a6fb0]", dot: "bg-[#52bdff]" },
  };
}

/** "핵심 결과" row — icon-circle + title/sub (inside the white card, light).
 *  A confirmed/positive finding (ok=true) takes the same low/medium/high
 *  tier color as the score gauge (파란/노란/빨강) — a "제작 이력이 확인되었습니다"
 *  row should read as calmer when the overall verdict is 낮음 and more
 *  alarming when it's 높음, matching the design handoff's 4-variant color
 *  spec. A negative/not-found row (ok=false) stays neutral gray regardless
 *  of tier — absence of evidence isn't itself a tier-colored signal. */
function KeyFindingRow({ ok, title, sub, tone }: { ok: boolean; title: string; sub: string; tone: { badgeBg: string; badgeText: string } }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-black/6 bg-black/[0.02] px-4 py-3">
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${ok ? "" : "bg-black/8 text-[#6a6a6a]"}`}
        style={ok ? { backgroundColor: tone.badgeBg, color: tone.badgeText } : undefined}
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

/** 의심 부위 박스의 모서리 액센트 — 목업처럼 굵고 끝이 둥근 ㄱ자 호를 그린다.
 *  (예전에는 2×2 사각형 점이었다.) 박스는 가로세로 비율이 제각각이라 SVG를
 *  박스에 늘려 씌우면 호가 타원으로 찌그러지므로, 고정 크기 SVG 4개를 각
 *  모서리에 앉히고 90°씩 돌려서 쓴다 — 어떤 비율에서도 모양이 같다. */
function CornerMark({ position, color }: { position: string; color: string }) {
  return (
    // pointer-events-none: 모서리 표시는 장식일 뿐 클릭 대상이 아니다. 이게 없으면
    // 17×17 SVG 박스가 자기 박스 경계 바깥 4px까지 클릭을 가로채서, 아래 깔린 더 큰
    // 박스를 그 언저리에서 누를 수 없게 된다(면적순 z-index로 작은 박스가 위에 있음).
    <svg viewBox="0 0 20 20" aria-hidden="true" className={`pointer-events-none absolute h-[17px] w-[17px] ${position}`} style={{ color }}>
      <path d="M3.5 13 V 10 A 6.5 6.5 0 0 1 10 3.5 H 13" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
    </svg>
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
function AccordionRow({
  title,
  subtitle,
  evidenceType,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle: string;
  evidenceType: EvidenceType;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // 펼칠 때만 보낸다 — 접는 동작까지 세면 한 번 열어본 근거가 두 건으로 잡힌다.
  // 전송은 setOpen 콜백 밖에서 한다. 업데이터 함수는 순수해야 하고, StrictMode는
  // 그걸 두 번 호출할 수 있어서 안에 넣으면 이벤트가 중복 전송된다.
  const toggle = () => {
    if (!open) trackEvidenceExpand(evidenceType);
    setOpen((wasOpen) => !wasOpen);
  };
  return (
    <div className="rounded-xl border border-black/8">
      <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left">
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

function formatCapturedAt(iso: string, locale: Locale): string {
  try {
    return new Date(iso).toLocaleString(locale === "en" ? "en-US" : "ko-KR", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

interface AnalysisResultViewProps {
  analysisResult: AnalysisResult;
  previewUrl: string | null;
  errorMessage?: string | null;
  /** History detail page only — omit to hide the "목록으로" back link. */
  backHref?: string;
  /** Where the login redirect lands the browser back on — see handleDetailClick. */
  returnPath: string;
}

export default function AnalysisResultView({ analysisResult, previewUrl, errorMessage, backHref, returnPath }: AnalysisResultViewProps) {
  const { locale } = useLanguage();
  const SEVERITY_CONFIG = severityConfig(locale);
  const [showDetail, setShowDetail] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [loginPending, setLoginPending] = useState(false);
  const [selectedRegionIndex, setSelectedRegionIndex] = useState<number | null>(null);

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
  const tone = toneForScore(scorePercent);
  const allProvidersFailed = visionResults.length > 0 && visionResults.every((v) => v.error_message);

  const duplicateCheck = analysisResult.duplicate_check;
  const duplicateMatches = duplicateCheck?.matches ?? [];
  const closestMatch = duplicateMatches[0];

  const keyFindings = [
    {
      ok: Boolean(metadata?.exif_found),
      title: metadata?.exif_found
        ? localized(locale, "촬영 정보가 확인되었습니다.", "Capture information was found.")
        : localized(locale, "촬영 정보를 확인할 수 없습니다.", "No capture information was found."),
      sub: metadata?.exif_found
        ? localized(locale, "카메라로 촬영된 기록이 남아 있습니다.", "A record of capture by a camera remains.")
        : localized(locale, "EXIF·촬영 기록이 이미지에 남아 있지 않습니다.", "No EXIF or capture record remains in the image."),
    },
    {
      ok: Boolean(metadata?.c2pa_found),
      title: metadata?.c2pa_found
        ? localized(locale, "제작 이력이 확인되었습니다.", "Creation history was found.")
        : localized(locale, "제작 이력을 확인할 수 없습니다.", "No creation history was found."),
      sub: metadata?.c2pa_found
        ? localized(locale, "Content Credentials(C2PA) 서명이 포함되어 있습니다.", "A Content Credentials (C2PA) signature is present.")
        : localized(locale, "제작·편집 기록(C2PA)이 이미지에 남아 있지 않습니다.", "No creation/editing record (C2PA) remains in the image."),
    },
    duplicateCheck?.used_cached_result && closestMatch
      ? {
          ok: true,
          title: localized(locale, "동일한 이미지를 이전에 분석한 적이 있습니다.", "An identical image was analyzed previously."),
          sub: localized(
            locale,
            `요청 ID ${closestMatch.request_id}의 판정을 그대로 사용했습니다 — 그때 판정: ${closestMatch.is_ai_generated ? "AI 생성" : "실제 이미지"}.`,
            `Reused the verdict from request ID ${closestMatch.request_id} — that verdict was: ${closestMatch.is_ai_generated ? "AI-generated" : "a real photo"}.`,
          ),
        }
      : duplicateCheck?.influenced_score && closestMatch
        ? {
            ok: false,
            title: localized(
              locale,
              `유사한 이미지 ${duplicateMatches.length}건이 발견되어 결과에 반영되었습니다.`,
              `${duplicateMatches.length} similar image(s) were found and factored into this result.`,
            ),
            sub: localized(
              locale,
              `가장 유사한 요청 ID ${closestMatch.request_id}의 판정(${closestMatch.is_ai_generated ? "AI 생성" : "실제 이미지"})이 이번 점수에 영향을 주었습니다.`,
              `The verdict from the closest match, request ID ${closestMatch.request_id} (${closestMatch.is_ai_generated ? "AI-generated" : "a real photo"}), influenced this score.`,
            ),
          }
        : {
            ok: duplicateMatches.length === 0,
            title:
              duplicateMatches.length === 0
                ? localized(locale, "자사 DB에서 동일한 이미지가 발견되지 않았습니다.", "No identical image was found in our database.")
                : localized(locale, `유사한 이미지 ${duplicateMatches.length}건이 발견되었습니다.`, `${duplicateMatches.length} similar image(s) were found.`),
            sub:
              duplicateMatches.length === 0
                ? localized(locale, "이전에 분석한 이미지 중 일치하는 항목이 없습니다.", "No match was found among previously analyzed images.")
                : localized(locale, "유사도가 낮아 이번 결과에는 반영되지 않았습니다.", "The similarity was too low to factor into this result."),
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
      alert(localized(locale, `로그인을 시작할 수 없습니다: ${error.message}`, `Could not start sign-in: ${error.message}`));
    }
    // 성공하면 브라우저가 완전히 떠나므로 이 아래는 실행되지 않음 — OAuth 왕복 후
    // returnPath로 돌아와 이 결과가 그대로 재구성됨(props 주석 참고).
  };

  return (
    <>
      {backHref && (
        <Link href={backHref} className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-[#9a9aa4] hover:text-[#f4f4f6]">
          <ChevronLeft className="h-3.5 w-3.5" /> {localized(locale, "목록으로", "Back to list")}
        </Link>
      )}

      {errorMessage && <ErrorState message={errorMessage} />}

      <div className="mx-auto max-w-4xl">
        {allProvidersFailed && (
          <div className="mb-4 rounded-xl border border-amber-400/25 bg-amber-400/10 px-5 py-4 text-sm text-amber-200">
            <span className="font-semibold">{localized(locale, "모든 비전 모델 호출이 실패했습니다.", "All vision model calls failed.")}</span>{" "}
            {localized(locale, "아래 결과는 메타데이터 분석만 반영된 값입니다.", "The result below reflects the metadata analysis only.")}
          </div>
        )}

        {/* 결과 카드 — 디자인 목업 기준 흰 카드(다크 페이지 위) */}
        <div className="overflow-hidden rounded-3xl bg-white p-6 shadow-2xl sm:p-7">
          <div className="flex flex-col gap-6 md:flex-row">
            {/* 좌측: 이미지 + 의심 부위 오버레이 */}
            <div className="shrink-0 md:w-[300px]">
              <div className="relative">
                {/* 이미지 자체만 overflow-hidden — 아래 오버레이 레이어는 별도로 둬서
                    가장자리에 붙는 바운딩 박스의 모서리 핸들이 잘리지 않게 함 */}
                <div className="overflow-hidden rounded-2xl bg-[#f2f2f2]">
                  {previewUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- data:/signed URL, next/image adds no value here
                    <img src={previewUrl} alt={localized(locale, "분석 대상 이미지", "Analyzed image")} className="block w-full" />
                  )}
                </div>
                {previewUrl && suspiciousRegions.length > 0 && (
                  <div className="pointer-events-none absolute inset-0">
                    {suspiciousRegions.map((region, i) => {
                      if (!isValidBBox(region.bbox)) return null;
                      const w = region.bbox.x2 - region.bbox.x1;
                      const h = region.bbox.y2 - region.bbox.y1;
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => {
                            // 같은 박스를 다시 눌러 닫는 경우는 제외 — 아코디언과
                            // 같은 기준으로 "펼쳐본" 것만 센다. 박스 라벨/설명은
                            // 보내지 않는다(이미지에서 유래한 문자열이라).
                            if (selectedRegionIndex !== i) trackEvidenceExpand("roi_region");
                            setSelectedRegionIndex((prev) => (prev === i ? null : i));
                          }}
                          aria-label={localized(locale, `의심 부위 ${i + 1}: ${region.label} — 설명 보기`, `Suspicious area ${i + 1}: ${region.label} — view explanation`)}
                          aria-pressed={selectedRegionIndex === i}
                          className="pointer-events-auto absolute rounded-md border-2 transition-colors"
                          style={{
                            left: `${region.bbox.x1 * 100}%`,
                            top: `${region.bbox.y1 * 100}%`,
                            width: `${w * 100}%`,
                            height: `${h * 100}%`,
                            borderColor: tone.ring,
                            backgroundColor: selectedRegionIndex === i ? `${tone.ring}33` : "transparent",
                            // 박스는 투명해도 그 면 전체가 클릭을 받는다. 그래서 이미지
                            // 거의 전체를 덮는 큰 박스가 하나라도 있으면, 그 위에 겹친
                            // 작은 박스들이 DOM 순서에 따라 통째로 가려져 클릭이 안 됐다.
                            // 면적이 좁을수록 위로 올려서(넓이 → z-index 역순) 안쪽 박스가
                            // 항상 먼저 잡히게 한다 — 순서와 무관하게 성립.
                            zIndex: Math.max(1, Math.round((1 - w * h) * 1000)),
                          }}
                        >
                          {/* 모서리 액센트 — 박스 색은 전체 판정 등급(낮음/중간/높음)과
                              같은 톤을 씀("AI 탐지율 판단 기준" 색상 스펙과 동일). */}
                          <CornerMark position="-top-[4px] -left-[4px]" color={tone.ring} />
                          <CornerMark position="-top-[4px] -right-[4px] rotate-90" color={tone.ring} />
                          <CornerMark position="-bottom-[4px] -right-[4px] rotate-180" color={tone.ring} />
                          <CornerMark position="-bottom-[4px] -left-[4px] -rotate-90" color={tone.ring} />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {selectedRegionIndex === null && suspiciousRegions.some((r) => isValidBBox(r.bbox)) && (
                <p className="mt-2.5 text-center text-[12px] text-[#9a9aa4]">
                  {localized(locale, "표시된 박스를 클릭하면 의심 근거를 볼 수 있어요.", "Click a highlighted box to see the reason for suspicion.")}
                </p>
              )}

              {selectedRegionIndex !== null && suspiciousRegions[selectedRegionIndex] && (
                <div className="mt-2.5 rounded-xl border border-black/6 bg-black/[0.02] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-bold text-[#1a1a1a]">{suspiciousRegions[selectedRegionIndex].label}</span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        SEVERITY_CONFIG[suspiciousRegions[selectedRegionIndex].severity]?.badge ?? SEVERITY_CONFIG.low.badge
                      }`}
                    >
                      {SEVERITY_CONFIG[suspiciousRegions[selectedRegionIndex].severity]?.label ?? SEVERITY_CONFIG.low.label}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[12.5px] leading-5 text-[#5a5a5a]">{suspiciousRegions[selectedRegionIndex].description}</p>
                </div>
              )}

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
                    <p className="text-[13px] font-bold text-[#1a1a1a]">{localized(locale, "핵심 결과", "Key findings")}</p>
                    {keyFindings.map((f, i) => (
                      <KeyFindingRow key={i} ok={f.ok} title={f.title} sub={f.sub} tone={tone} />
                    ))}
                  </div>

                  <RecommendationPanel recommendedAction={analysisResult.recommended_action} />

                  <button
                    type="button"
                    onClick={handleDetailClick}
                    disabled={loginPending}
                    className="w-full rounded-xl bg-[#52bdff] py-3 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-60"
                  >
                    {loginPending ? localized(locale, "이동 중…", "Redirecting…") : localized(locale, "자세한 분석 보기", "View detailed analysis")}
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <button type="button" onClick={() => setShowDetail(false)} className="flex items-center gap-1.5 text-[15px] font-bold text-[#1a1a1a]">
                    <ChevronLeft className="h-4 w-4" /> {localized(locale, "자세한 분석", "Detailed analysis")}
                  </button>

                  {/* defaultOpen이라 처음부터 펼쳐져 있다 — 사용자가 직접 누른 게
                      아니므로 evidence_expand는 나가지 않는다(접었다 다시 펼치면 나감). */}
                  <AccordionRow
                    evidenceType="ai_analysis"
                    title={localized(locale, "AI 생성 분석", "AI-generation analysis")}
                    subtitle={localized(locale, "질감 · 패턴 · 경계 검사", "Texture · pattern · boundary check")}
                    defaultOpen
                  >
                    <SpecRow label={localized(locale, "종합 점수", "Overall score")} value={`${scorePercent} / 100`} />
                    {visionResults
                      .filter((v) => !v.error_message)
                      .map((v, i) => (
                        <SpecRow
                          key={i}
                          label={PROVIDER_DISPLAY_NAMES[v.provider] ?? v.provider}
                          value={`${
                            v.is_ai_generated === true
                              ? localized(locale, "AI 생성 의심", "Possibly AI-generated")
                              : v.is_ai_generated === false
                                ? localized(locale, "실제 이미지", "Real photo")
                                : localized(locale, "판단 불확실", "Uncertain")
                          } (${Math.round((v.score <= 1 ? v.score * 100 : v.score))}%)`}
                        />
                      ))}
                    {suspiciousRegions.length > 0 && (
                      <SpecRow
                        label={localized(locale, "의심 영역", "Suspicious areas")}
                        value={localized(locale, `${suspiciousRegions.length}건 발견`, `${suspiciousRegions.length} found`)}
                      />
                    )}
                    <p className="mt-2 border-t border-black/6 pt-2 text-xs leading-5 text-[#8a8a8a]">
                      {localized(
                        locale,
                        "여러 검출 모델의 결과를 종합한 점수이며, 단독으로 진위를 판정하지 않습니다.",
                        "This score combines results from multiple detection models and is not, by itself, a determination of authenticity.",
                      )}
                    </p>
                  </AccordionRow>

                  <AccordionRow
                    evidenceType="exif"
                    title={localized(locale, "촬영 정보 (EXIF)", "Capture info (EXIF)")}
                    subtitle={localized(locale, "카메라 · 촬영 조건", "Camera · capture conditions")}
                  >
                    {camera ? (
                      <>
                        {(camera.make || camera.model) && (
                          <SpecRow label={localized(locale, "카메라", "Camera")} value={[camera.make, camera.model].filter(Boolean).join(" ")} />
                        )}
                        {camera.captured_at && (
                          <SpecRow label={localized(locale, "촬영 일시", "Captured at")} value={formatCapturedAt(camera.captured_at, locale)} />
                        )}
                        {(camera.exposure_time || camera.f_number || camera.iso) && (
                          <SpecRow
                            label={localized(locale, "노출", "Exposure")}
                            value={[camera.exposure_time, camera.f_number, camera.iso ? `ISO ${camera.iso}` : null].filter(Boolean).join(" · ")}
                          />
                        )}
                        <SpecRow label={localized(locale, "위치 정보", "Location data")} value={camera.has_gps ? localized(locale, "포함", "Included") : localized(locale, "미포함", "Not included")} />
                      </>
                    ) : (
                      <SpecRow label="EXIF" value={localized(locale, "확인 불가", "Unavailable")} />
                    )}
                    <p className="mt-2 border-t border-black/6 pt-2 text-xs leading-5 text-[#8a8a8a]">
                      {localized(
                        locale,
                        "EXIF는 촬영 기기가 이미지에 남기는 기록으로, 편집 과정에서 삭제될 수 있습니다.",
                        "EXIF is a record left by the capture device — it can be removed during editing.",
                      )}
                    </p>
                  </AccordionRow>

                  <AccordionRow
                    evidenceType="c2pa"
                    title={localized(locale, "콘텐츠 제작 이력 (C2PA)", "Content provenance (C2PA)")}
                    subtitle={localized(locale, "제작 · 편집 이력", "Creation · editing history")}
                  >
                    <SpecRow
                      label={localized(locale, "서명 상태", "Signature status")}
                      value={metadata?.c2pa_found ? localized(locale, "서명 있음", "Signed") : localized(locale, "서명 없음", "Not signed")}
                    />
                    <SpecRow label={localized(locale, "편집 이력", "Edit history")} value={localized(locale, "확인 불가", "Unavailable")} />
                    <SpecRow label={localized(locale, "발급 기관", "Issuer")} value="—" />
                    <p className="mt-2 border-t border-black/6 pt-2 text-xs leading-5 text-[#8a8a8a]">
                      {localized(
                        locale,
                        "C2PA는 제작·편집 이력을 암호학적으로 서명하는 국제 표준입니다. 서명이 없다는 것이 AI 생성을 의미하지는 않습니다.",
                        "C2PA is an international standard for cryptographically signing creation/editing history. The absence of a signature does not mean the image is AI-generated.",
                      )}
                    </p>
                  </AccordionRow>

                  <AccordionRow
                    evidenceType="image_metadata"
                    title={localized(locale, "이미지 메타데이터", "Image metadata")}
                    subtitle={localized(locale, "파일 기본 정보", "Basic file information")}
                  >
                    <SpecRow
                      label={localized(locale, "파일 형식", "File format")}
                      value={(metadata?.file_info.format ?? analysisResult.input.mime_type ?? localized(locale, "알 수 없음", "Unknown")).toUpperCase()}
                    />
                    <SpecRow label={localized(locale, "해상도", "Resolution")} value={`${analysisResult.input.width} × ${analysisResult.input.height}`} />
                    {Boolean(metadata?.file_info.size_bytes) && <SpecRow label={localized(locale, "용량", "File size")} value={formatBytes(metadata!.file_info.size_bytes)} />}
                    {metadata?.file_info.color_space && <SpecRow label={localized(locale, "색 공간", "Color space")} value={metadata.file_info.color_space} />}
                  </AccordionRow>

                  <AccordionRow
                    evidenceType="similar_search"
                    title={localized(locale, "유사 이미지 검색", "Similar image search")}
                    subtitle={localized(locale, "DB 내 이미지 역탐지", "Reverse search within our database")}
                  >
                    <SpecRow
                      label={localized(locale, "동일 이미지", "Identical images")}
                      value={localized(locale, `${duplicateCheck?.used_cached_result ? 1 : 0}건`, `${duplicateCheck?.used_cached_result ? 1 : 0}`)}
                    />
                    <SpecRow label={localized(locale, "유사 이미지", "Similar images")} value={localized(locale, `${duplicateMatches.length}건`, `${duplicateMatches.length}`)} />
                    <SpecRow label={localized(locale, "최초 게시 추정", "Estimated first posted")} value={localized(locale, "확인 불가", "Unavailable")} />
                    <p className="mt-2 border-t border-black/6 pt-2 text-xs leading-5 text-[#8a8a8a]">
                      {localized(
                        locale,
                        "Imalytix에 이전에 분석 이력이 있는 이미지만 대상으로 합니다.",
                        "Only covers images that Imalytix has analyzed before.",
                      )}
                    </p>
                  </AccordionRow>

                  <p className="text-center text-xs leading-5 text-[#8a8a8a]">
                    {localized(
                      locale,
                      "Imalytix의 분석은 판단을 돕기 위한 참고 정보이며, 정확하지 않을 수 있습니다.",
                      "Imalytix's analysis is reference information to help you decide, and may not be accurate.",
                    )}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        <p className="mt-6 text-center text-sm leading-6 text-[#9a9aa4]">
          {localized(
            locale,
            "Imalytix는 확률을 기반으로 결과를 제공합니다. 탐지 결과가 완벽하지 않을 수 있으니, 최종 판단은 신중히 내려 주시기 바랍니다.",
            "Imalytix provides results based on probability. Detection results may not be perfect, so please make your final judgment carefully.",
          )}
        </p>

        <FeedbackForm requestId={analysisResult.request_id} />
      </div>
    </>
  );
}
