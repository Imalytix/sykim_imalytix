"use client";

import { Check, FileCheck2, Layers, ScanEye, X } from "lucide-react";
import { useState } from "react";
import AnalysisStepsLoader from "@/components/results/AnalysisStepsLoader";
import AnalysisResultView from "@/components/results/AnalysisResultView";
import AppFooter from "@/components/layout/AppFooter";
import AppHeader from "@/components/layout/AppHeader";
import ImageUploader from "@/components/upload/ImageUploader";
import type { AnalysisResult } from "@/types/analysis";

const USE_CASES = [
  { tag: "SNS", emoji: "📱", title: "화제의 그 사진,\n진짜일까요?", desc: "공유하기 전에 1초만 — 가짜 이미지 확산을 막습니다.", gradient: "from-[#0ea5e9] to-[#0c4a6e]" },
  { tag: "온라인 거래", emoji: "📦", title: "상품 사진이\n거래의 신뢰가 됩니다", desc: "중고거래·쇼핑몰 상품 이미지의 진위를 미리 확인하세요.", gradient: "from-[#f5d0fe] to-[#7e22ce]" },
  { tag: "음식 리뷰", emoji: "🍜", title: "리뷰 사진,\n믿고 주문하세요", desc: "보정을 넘어선 생성 이미지 리뷰를 걸러냅니다.", gradient: "from-[#fed7aa] to-[#9a3412]" },
  { tag: "숙소·부동산", emoji: "🏠", title: "사진만 보고\n계약하기 전에", desc: "매물·숙소 사진이 실제 공간인지 먼저 검증하세요.", gradient: "from-[#bbf7d0] to-[#15803d]" },
  { tag: "데이팅 앱", emoji: "💜", title: "프로필 사진 뒤의\n진짜 사람", desc: "AI로 만든 가짜 프로필로부터 안전한 만남을 지킵니다.", gradient: "from-[#fbcfe8] to-[#db2777]" },
  { tag: "뉴스·미디어", emoji: "📰", title: "속보 속 그 장면,\n사실일까요?", desc: "기사에 실린 이미지의 생성 여부를 보도 전에 확인합니다.", gradient: "from-[#e0e7ff] to-[#4338ca]" },
];

const TECH = [
  { icon: <Layers className="h-5 w-5" />, title: "Fusion Engine", desc: "여러 AI 모델의 분석 결과를 융합해 하나의 모델만 봤을 때의 한계를 보완합니다." },
  { icon: <ScanEye className="h-5 w-5" />, title: "Multi-model Analysis", desc: "서로 다른 관점의 AI 모델이 이미지를 동시에 대조 분석합니다." },
  { icon: <FileCheck2 className="h-5 w-5" />, title: "Explainable Results", desc: "결과와 함께 판단 근거를 제공하여 사용자가 직접 확인하고 이해할 수 있습니다." },
];

// 히어로 뒤에 흩뿌려진 장식용 카드 — 실제 사진 대신 브랜드 톤 그라데이션 블록.
const DECOR_CARDS = [
  { className: "left-[4%] top-[8%] -rotate-12", gradient: "from-[#dbeafe] to-[#93c5fd]" },
  { className: "right-[6%] top-[4%] rotate-6", gradient: "from-[#0ea5e9] to-[#0c4a6e]" },
  { className: "left-[10%] bottom-[6%] rotate-6", gradient: "from-[#e0e7ff] to-[#4338ca]" },
  { className: "right-[10%] bottom-[10%] -rotate-6", gradient: "from-[#fed7aa] to-[#9a3412]" },
  { className: "left-[22%] top-[2%] rotate-3", gradient: "from-[#bbf7d0] to-[#15803d]" },
  { className: "right-[22%] bottom-[2%] -rotate-3", gradient: "from-[#fbcfe8] to-[#db2777]" },
];

async function analyzeImageFile(file: File): Promise<AnalysisResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("mode", "standard");

  const response = await fetch("/api/analyze/image", { method: "POST", body: formData });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.detail ?? "분석에 실패했습니다.");
  return data as AnalysisResult;
}

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleAnalyze = async () => {
    if (!selectedFile) {
      setErrorMessage("이미지를 먼저 선택해주세요.");
      return;
    }
    try {
      setErrorMessage(null);
      setIsLoading(true);
      const result = await analyzeImageFile(selectedFile);
      setPreviewUrl(result.analyzed_image_data_url);
      setAnalysisResult(result);
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
  };

  const showHero = !analysisResult && !isLoading;

  return (
    <div className="min-h-screen bg-black">
      <AppHeader />

      {showHero && (
        <section id="top" className="relative overflow-hidden border-b border-white/6 bg-black py-20 text-center">
          {/* 장식용 그라데이션 카드 — 실사진 없이 브랜드 톤으로 대체 */}
          <div className="pointer-events-none absolute inset-0 hidden sm:block" aria-hidden="true">
            {DECOR_CARDS.map((c, i) => (
              <div
                key={i}
                className={`absolute h-24 w-20 rounded-2xl bg-gradient-to-br opacity-25 blur-[1px] ${c.className} ${c.gradient}`}
              />
            ))}
          </div>

          <div className="relative mx-auto max-w-2xl px-6">
            <h1 className="text-4xl font-bold tracking-tight text-[#f4f4f6] lg:text-5xl">더 확실한 판단을 위한 이미지 검증</h1>
            <p className="mt-4 text-[15px] leading-relaxed text-[#9a9aa4]">
              imalytix는 AI 생성 여부와 이미지 조작 가능성을 다양한 포렌식 분석으로 검증하고,
              <br className="hidden sm:block" />
              판단 근거까지 제공하는 이미지 검증 서비스입니다.
            </p>

            <div className="mt-10 flex flex-col items-center gap-4">
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

              {errorMessage && (
                <div className="w-full max-w-sm rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-200">
                  {errorMessage}
                </div>
              )}

              <button
                type="button"
                onClick={handleAnalyze}
                className="rounded-xl bg-[#52bdff] px-8 py-3 text-sm font-bold tracking-tight text-white shadow-[0_10px_30px_rgba(82,189,255,0.35)] transition hover:-translate-y-0.5"
              >
                이미지 검증하기
              </button>
            </div>
          </div>
        </section>
      )}

      <main className="mx-auto w-full max-w-5xl px-6 py-10">
        {isLoading && (
          <div className="mx-auto max-w-2xl">
            <AnalysisStepsLoader active={isLoading} />
          </div>
        )}

        {analysisResult && !isLoading && (
          <AnalysisResultView
            analysisResult={analysisResult}
            previewUrl={previewUrl}
            errorMessage={errorMessage}
            onReset={handleReset}
            returnPath={`/result/${analysisResult.request_id}`}
          />
        )}

        {showHero && (
          <>
            {/* 판단 근거 제공 — 실제 결과 화면을 미리 보여주는 예시(장식용, 실제 데이터 아님) */}
            <section className="mt-24 text-center">
              <h2 className="text-2xl font-extrabold tracking-tight text-[#f4f4f6] sm:text-3xl">결과만이 아닌, 판단 근거까지 제공합니다.</h2>
              <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-[#9a9aa4]">
                AI 생성 가능성과 다양한 분석 결과를 함께 확인하여, 결과를 더 쉽게 이해하고 판단할 수 있습니다.
              </p>

              <div className="mx-auto mt-10 flex max-w-xl flex-col gap-4 rounded-3xl border border-white/8 bg-white/[0.03] p-6 sm:flex-row">
                <div className="flex flex-1 items-center justify-center rounded-2xl bg-gradient-to-br from-[#dbeafe] to-[#93c5fd]" style={{ aspectRatio: "1 / 1" }}>
                  <span className="text-5xl">📱</span>
                </div>
                <div className="flex-1 overflow-hidden rounded-2xl bg-white text-left text-[#1a1a1a]">
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="flex items-center gap-1 text-[12px] font-bold">
                      <span className="h-2 w-2 rounded-full bg-[#52bdff]" /> imalytix
                    </span>
                    <X className="h-3.5 w-3.5 text-[#bbb]" />
                  </div>
                  <div className="border-t border-black/6 px-4 py-2.5 text-[11px] text-[#8a8a8a]">이 이미지를 분석했습니다. · 방금 전</div>
                  <div className="flex flex-col items-center gap-2 px-4 py-5">
                    <div className="relative flex h-16 w-16 items-center justify-center rounded-full border-4 border-[#f23e3e]">
                      <span className="text-[15px] font-extrabold">75%</span>
                    </div>
                    <span className="rounded-full bg-[#f23e3e] px-2.5 py-0.5 text-[10px] font-bold text-white">높음</span>
                    <p className="mt-1 text-[11px] text-[#7a7a7a]">AI 생성 이미지일 가능성이 높습니다.</p>
                  </div>
                  <div className="border-t border-black/6 px-4 py-2.5 text-[11px] font-bold">핵심 결과</div>
                </div>
              </div>
            </section>

            {/* 이런 상황에서 쓰세요 — 가로 스크롤 카드 */}
            <section className="mt-24 text-center">
              <h2 className="text-2xl font-extrabold tracking-tight text-[#f4f4f6] sm:text-3xl">이미지를 믿기 어려운 AI 시대</h2>
              <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-[#9a9aa4]">
                이제 실제와 구분하기 어려운 이미지를 만들어냅니다.
                <br className="hidden sm:block" />
                중요한 이미지는 눈으로만 판단하기보다, 검증을 통해 확인해야 합니다.
              </p>
              <div className="mt-10 -mx-6 flex snap-x gap-4 overflow-x-auto px-6 pb-4">
                {USE_CASES.map((uc) => (
                  <article
                    key={uc.tag}
                    className={`relative flex w-[220px] shrink-0 snap-start flex-col overflow-hidden rounded-2xl bg-gradient-to-br p-5 text-left ${uc.gradient}`}
                    style={{ minHeight: 230 }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                    <span className="relative w-fit rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur">{uc.tag}</span>
                    <span className="relative mt-auto text-3xl">{uc.emoji}</span>
                    <h3 className="relative mt-2 whitespace-pre-line text-[15px] font-extrabold leading-snug text-white">{uc.title}</h3>
                    <p className="relative mt-1.5 text-xs leading-relaxed text-white/85">{uc.desc}</p>
                  </article>
                ))}
              </div>
            </section>

            {/* 기술 신뢰도 */}
            <section id="tech" className="mt-24 rounded-3xl border border-white/8 bg-white/[0.02] px-6 py-16 text-center">
              <h2 className="text-2xl font-extrabold tracking-tight text-[#f4f4f6] sm:text-3xl">국내외 AI 전문가의 자문을 바탕으로 설계했습니다</h2>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-[#9a9aa4]">
                탐지 모델 구조와 검증 방식은 KAIST 연구실, KT AX 전략팀과
                <br className="hidden sm:block" />
                해외 유명 대학 ML 엔지니어의 자문을 통해 설계되었습니다.
              </p>
              <div className="mx-auto mt-10 grid max-w-3xl gap-5 text-left sm:grid-cols-3">
                {TECH.map((t) => (
                  <div key={t.title} className="rounded-2xl border border-white/9 bg-white/[0.04] p-7 transition hover:border-[#52bdff]/40">
                    <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-[#52bdff]/15 text-[#52bdff]">{t.icon}</div>
                    <div className="text-[17px] font-extrabold text-[#f4f4f6]">{t.title}</div>
                    <p className="mt-2 text-sm leading-relaxed text-[#9a9aa4]">{t.desc}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* 익스텐션 홍보 */}
            <section className="mt-24 text-center">
              <h2 className="text-2xl font-extrabold tracking-tight text-[#f4f4f6] sm:text-3xl">우클릭 한 번으로 이미지를 바로 검증하세요</h2>
              <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-[#9a9aa4]">
                별도의 업로드 없이, 보고 있는 이미지에서 바로 분석 결과를 확인할 수 있습니다.
              </p>
              <div className="mx-auto mt-10 flex max-w-sm flex-col items-center gap-6 rounded-3xl border border-white/8 bg-white/[0.04] p-10">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#52bdff]/15">
                  <Check className="h-6 w-6 text-[#52bdff]" />
                </div>
                <div>
                  <div className="text-lg font-extrabold text-[#f4f4f6]">Imalytix</div>
                  <p className="mt-1 text-sm text-[#9a9aa4]">판단을 돕는 이미지 신뢰 검증</p>
                </div>
              </div>
              <a
                href="#top"
                className="mt-8 inline-block rounded-xl bg-[#52bdff] px-8 py-3 text-sm font-bold tracking-tight text-white shadow-[0_10px_30px_rgba(82,189,255,0.35)] transition hover:-translate-y-0.5"
              >
                무료로 시작하기
              </a>
            </section>
          </>
        )}
      </main>

      <AppFooter />
    </div>
  );
}
