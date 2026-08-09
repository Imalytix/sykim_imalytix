"use client";

import { FileCheck2, Layers, ScanEye, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import AnalysisStepsLoader from "@/components/results/AnalysisStepsLoader";
import AnalysisResultView from "@/components/results/AnalysisResultView";
import AppFooter from "@/components/layout/AppFooter";
import AppHeader from "@/components/layout/AppHeader";
import ImageUploader from "@/components/upload/ImageUploader";
import type { AnalysisResult } from "@/types/analysis";

// 히어로 위쪽에 아치 모양으로 흩어진 실제 사진들. 반지름/각도로 계산하는
// 원 배치는 우리 히어로처럼 세로 공간이 짧은 섹션에서는 중앙(0도에 가까운)
// 카드가 섹션 바깥으로 밀려 올라가 통째로 사라지는 문제가 계속 나서(참고
// 프로토타입은 100vh 고정 히어로라 반지름을 크게 써도 괜찮지만 우리는 아님),
// 좌표를 직접 지정하는 방식으로 바꿈 — left는 % (화면 폭에 비례해 반응형),
// top은 px(섹션 상단에서 고정 거리)로 둬서 카드가 섹션 밖으로 사라질 일이
// 없도록 항상 안전한 범위 안에 있음.
const ARCH_CARDS = [
  { src: "/hero-photos/hero-1.jpg", leftPct: 15, topPx: 165, rotate: -9 },
  { src: "/hero-photos/hero-2.jpg", leftPct: 27, topPx: 105, rotate: -6 },
  { src: "/hero-photos/hero-3.jpg", leftPct: 37, topPx: 70, rotate: -4 },
  { src: "/hero-photos/hero-4.jpg", leftPct: 46, topPx: 55, rotate: 2 },
  { src: "/hero-photos/hero-5.jpg", leftPct: 55, topPx: 58, rotate: -3 },
  { src: "/hero-photos/hero-6.jpg", leftPct: 64, topPx: 80, rotate: 5 },
  { src: "/hero-photos/hero-7.jpg", leftPct: 74, topPx: 115, rotate: 7 },
  { src: "/hero-photos/hero-8.jpg", leftPct: 86, topPx: 160, rotate: 9 },
];

// 디자인 목업(Figma "이런 상황에서 쓰세요" 프레임)에서 카드 5장을 통째로
// 잘라낸 정적 이미지 — 배지·문구·일러스트가 전부 그 안에 그려져 있어서 텍스트를
// 따로 오버레이하지 않고 이미지 자체를 카드로 씀.
const USE_CASES = [
  { tag: "데이팅 앱", img: "/use-cases/dating.png" },
  { tag: "중고 거래", img: "/use-cases/secondhand.png" },
  { tag: "음식 리뷰", img: "/use-cases/food.png" },
  { tag: "숙소, 부동산", img: "/use-cases/housing.png" },
  { tag: "SNS", img: "/use-cases/sns.png" },
];

const TECH = [
  { icon: <Layers className="h-5 w-5" />, title: "Fusion Engine", desc: "여러 AI 모델의 분석 결과를 융합해 하나의 모델만 봤을 때의 한계를 보완합니다." },
  { icon: <ScanEye className="h-5 w-5" />, title: "Multi-model Analysis", desc: "서로 다른 관점의 AI 모델이 이미지를 동시에 대조 분석합니다." },
  { icon: <FileCheck2 className="h-5 w-5" />, title: "Explainable Results", desc: "결과와 함께 판단 근거를 제공하여 사용자가 직접 확인하고 이해할 수 있습니다." },
];

async function analyzeImageFile(file: File): Promise<AnalysisResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("mode", "standard");

  const response = await fetch("/api/analyze/image", { method: "POST", body: formData });
  // Vercel이 요청/응답 본문이 4.5MB를 넘으면 우리 라우트 코드가 실행되기도
  // 전에 플랫폼 레벨에서 JSON이 아닌 응답(예: "Request Entity Too Large")을
  // 돌려줄 수 있음 — response.json()이 그대로 SyntaxError를 던지면 사용자가
  // 원인 모를 파싱 에러 문구를 그대로 보게 되므로 안전하게 처리.
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 413) throw new Error("이미지 파일이 너무 큽니다. 더 작은 파일을 선택해주세요.");
    throw new Error(data?.detail ?? "분석에 실패했습니다.");
  }
  if (!data) throw new Error("서버 응답을 처리할 수 없습니다. 잠시 후 다시 시도해주세요.");
  return data as AnalysisResult;
}

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 아치 카드 전체가 스크롤에 맞춰 시계방향으로 살짝 돌아가고, 그중 첫 번째
  // 카드(hero-1)만 스크롤할수록 점점 커지고 진해지면서 "결과처럼" 강조되는
  // 효과 — 참고 프로토타입의 스크롤 연동 아치를 그대로 재현하는 대신(스크롤
  // 위치마다 반지름·카드 폭을 실시간 재계산하는 커스텀 물리 엔진이라 깨지기
  // 쉬움), 스크롤 진행도(0~1)만 계산해서 CSS transform에 흘려보내는 가벼운
  // 방식으로 단순화.
  const [scrollProgress, setScrollProgress] = useState(0);
  useEffect(() => {
    let rafId: number | null = null;
    const SCROLL_RANGE_PX = 650;
    const onScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        setScrollProgress(Math.min(1, window.scrollY / SCROLL_RANGE_PX));
        rafId = null;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  // "결과만이 아닌..." 예시 카드 — 화면에 스크롤되어 들어올 때마다 0%에서
  // 75%까지 게이지가 채워지고 숫자가 오르며, 다 오르고 나서 "높음" 배지와
  // 문구가 뒤이어 나타남. 다시 스크롤해서 벗어났다가 들어오면 처음부터 재생.
  const demoCardRef = useRef<HTMLDivElement | null>(null);
  const [demoPercent, setDemoPercent] = useState(0);
  const [demoTextVisible, setDemoTextVisible] = useState(false);
  useEffect(() => {
    const el = demoCardRef.current;
    if (!el) return;
    const DURATION_MS = 1200;
    const TARGET = 75;
    let rafId: number | null = null;
    let startedAt: number | null = null;

    const animate = (ts: number) => {
      if (startedAt === null) startedAt = ts;
      const t = Math.min(1, (ts - startedAt) / DURATION_MS);
      const eased = 1 - (1 - t) ** 3; // ease-out cubic
      setDemoPercent(Math.round(eased * TARGET));
      if (t < 1) {
        rafId = requestAnimationFrame(animate);
      } else {
        setDemoTextVisible(true);
      }
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          startedAt = null;
          setDemoTextVisible(false);
          setDemoPercent(0);
          rafId = requestAnimationFrame(animate);
        } else if (rafId !== null) {
          cancelAnimationFrame(rafId);
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  // 익스텐션 데모 영상 — 참고 사이트와 동일하게 화면에 보일 때만 재생하고
  // 벗어나면 멈춤(항상 자동재생하는 것보다 배터리/리소스 부담이 적음).
  const extVideoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const video = extVideoRef.current;
    if (!video) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) video.play().catch(() => {});
        else video.pause();
      },
      { threshold: 0.45 },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  const handleAnalyze = async (fileOverride?: File) => {
    const file = fileOverride ?? selectedFile;
    if (!file) {
      setErrorMessage("이미지를 먼저 선택해주세요.");
      return;
    }
    try {
      setErrorMessage(null);
      setIsLoading(true);
      const result = await analyzeImageFile(file);
      setPreviewUrl(result.analyzed_image_data_url);
      setAnalysisResult(result);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "분석에 실패했습니다.");
    } finally {
      setIsLoading(false);
    }
  };

  // 아치 카드를 클릭하면 그 사진을 바로 업로드한 것처럼 분석 시작 — 브라우저가
  // 우리 자신의 public/ 정적 파일을 fetch해서 File로 감싼 뒤 기존 파일 업로드
  // 경로를 그대로 재사용.
  const handleSampleClick = async (src: string) => {
    try {
      setErrorMessage(null);
      const response = await fetch(src);
      if (!response.ok) throw new Error("샘플 이미지를 불러올 수 없습니다.");
      const blob = await response.blob();
      const filename = src.split("/").pop() ?? "sample.jpg";
      const file = new File([blob], filename, { type: blob.type || "image/jpeg" });
      setSelectedFile(file);
      setPreviewUrl(src);
      await handleAnalyze(file);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "샘플 이미지를 불러올 수 없습니다.");
    }
  };

  const handleReset = () => {
    setAnalysisResult(null);
    setSelectedFile(null);
    setPreviewUrl(null);
    setErrorMessage(null);
    // 결과 화면은 히어로 업로드 영역보다 페이지 아래쪽에 있으므로, 리셋 후
    // 다시 나타나는 히어로(업로드 박스)가 보이도록 맨 위로 스크롤합니다.
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const showHero = !analysisResult && !isLoading;

  return (
    <div className="min-h-screen bg-black">
      <AppHeader />

      {showHero && (
        <section id="top" className="relative overflow-hidden border-b border-white/6 bg-black py-20 text-center">
          {/* 아치형 사진 카드 — 클릭하면 그 사진으로 바로 검증 시작. 전체가
              스크롤에 맞춰 살짝 회전하고, 첫 번째 카드는 스크롤할수록 커지고
              진해지면서 "결과가 나타나는" 듯한 느낌을 줌. */}
          <div className="pointer-events-none absolute inset-0 hidden sm:block" style={{ transform: `rotate(${scrollProgress * 22}deg)` }}>
            {ARCH_CARDS.map((c, i) => {
              const isHero = i === 0;
              const baseTransform = `translate(-50%, -50%) rotate(${c.rotate}deg)`;
              return (
                <button
                  key={c.src}
                  type="button"
                  onClick={() => handleSampleClick(c.src)}
                  aria-label="샘플 이미지로 바로 검증하기"
                  className={`pointer-events-auto absolute h-28 w-24 overflow-hidden rounded-2xl shadow-lg transition-[opacity,transform] duration-300 ${
                    isHero ? "" : "opacity-25 hover:opacity-80 hover:scale-105"
                  }`}
                  style={{
                    left: `${c.leftPct}%`,
                    top: `${c.topPx}px`,
                    transform: isHero ? `${baseTransform} scale(${1 + scrollProgress * 0.7}) translateY(${scrollProgress * 24}px)` : baseTransform,
                    opacity: isHero ? 0.25 + scrollProgress * 0.75 : undefined,
                    zIndex: isHero ? 10 : 1,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- public/ 정적 데모 자산, next/image 이점 없음 */}
                  <img src={c.src} alt="" className="h-full w-full object-cover" />
                </button>
              );
            })}
          </div>

          <div className="relative mx-auto max-w-2xl px-6">
            <h1 className="animate-fade-in-up text-4xl font-bold tracking-tight text-[#f4f4f6] lg:text-5xl">
              더 확실한 판단을 위한 이미지 검증
            </h1>
            <p className="animate-fade-in-up mt-4 text-[15px] leading-relaxed text-[#9a9aa4] [animation-delay:120ms]">
              imalytix는 AI 생성 여부와 이미지 조작 가능성을 다양한 포렌식 분석으로 검증하고,
              <br className="hidden sm:block" />
              판단 근거까지 제공하는 이미지 검증 서비스입니다.
            </p>

            <div className="animate-fade-in-up mt-10 flex flex-col items-center gap-4 [animation-delay:240ms]">
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
                onClick={() => handleAnalyze()}
                className="rounded-xl bg-[#52bdff] px-8 py-3 text-sm font-bold tracking-tight text-white shadow-[0_10px_30px_rgba(82,189,255,0.35)] transition hover:-translate-y-0.5"
              >
                이미지 검증하기
              </button>
            </div>
          </div>
        </section>
      )}

      <main className="mx-auto w-full max-w-5xl px-6 py-10">
        <AnalysisStepsLoader active={isLoading} previewUrl={previewUrl} />

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
                <div className="flex-1 overflow-hidden rounded-2xl" style={{ aspectRatio: "1 / 1" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- 장식용 예시 이미지, next/image 이점 없음 */}
                  <img src="/hero-photos/hero-1.jpg" alt="" className="h-full w-full object-cover" />
                </div>
                <div ref={demoCardRef} className="flex-1 overflow-hidden rounded-2xl bg-white text-left text-[#1a1a1a]">
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="flex items-center gap-1 text-[12px] font-bold">
                      <span className="h-2 w-2 rounded-full bg-[#52bdff]" /> imalytix
                    </span>
                    <X className="h-3.5 w-3.5 text-[#bbb]" />
                  </div>
                  <div className="border-t border-black/6 px-4 py-2.5 text-[11px] text-[#8a8a8a]">이 이미지를 분석했습니다. · 방금 전</div>
                  <div className="flex flex-col items-center gap-2 px-4 py-5">
                    <div
                      className="relative flex h-16 w-16 items-center justify-center rounded-full"
                      style={{ background: `conic-gradient(#f23e3e ${demoPercent * 3.6}deg, #f2f2f2 0deg)` }}
                    >
                      <div className="absolute inset-[3px] flex items-center justify-center rounded-full bg-white">
                        <span className="text-[15px] font-extrabold">{demoPercent}%</span>
                      </div>
                    </div>
                    <span
                      className={`rounded-full bg-[#f23e3e] px-2.5 py-0.5 text-[10px] font-bold text-white transition-opacity duration-500 ${demoTextVisible ? "opacity-100" : "opacity-0"}`}
                    >
                      높음
                    </span>
                    <p className={`mt-1 text-[11px] text-[#7a7a7a] transition-opacity duration-500 ${demoTextVisible ? "opacity-100" : "opacity-0"}`}>
                      AI 생성 이미지일 가능성이 높습니다.
                    </p>
                  </div>
                  <div className="border-t border-black/6 px-4 py-2.5 text-[11px] font-bold">핵심 결과</div>
                </div>
              </div>
            </section>

            {/* 이런 상황에서 쓰세요 — 좌측으로 계속 흘러가는 카드 행 */}
            <section className="mt-24 text-center">
              <h2 className="text-2xl font-extrabold tracking-tight text-[#f4f4f6] sm:text-3xl">이미지를 믿기 어려운 AI 시대</h2>
              <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-[#9a9aa4]">
                이제 실제와 구분하기 어려운 이미지를 만들어냅니다.
                <br className="hidden sm:block" />
                중요한 이미지는 눈으로만 판단하기보다, 검증을 통해 확인해야 합니다.
              </p>
              <div className="mt-10 overflow-hidden">
                {/* 카드 목록을 통째로 두 번 이어붙여서 -50%까지 흘러가면 이음매 없이 반복 */}
                <div className="animate-marquee flex w-max gap-4">
                  {[...USE_CASES, ...USE_CASES].map((uc, i) => (
                    // eslint-disable-next-line @next/next/no-img-element -- public/ 정적 디자인 에셋, next/image 이점 없음
                    <img key={`${uc.tag}-${i}`} src={uc.img} alt={uc.tag} className="h-[312px] w-[220px] shrink-0 rounded-2xl" />
                  ))}
                </div>
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

            {/* 익스텐션 홍보 — 참고 사이트(PART 5 · EXTENSION VIDEO)와 동일한 구성 */}
            <section className="mt-24 text-center">
              <h2 className="text-2xl font-extrabold tracking-tight text-[#f4f4f6] sm:text-3xl">브라우저 익스텐션으로, 보던 화면 그대로</h2>
              <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-[#9a9aa4]">
                설치 한 번이면 뉴스·SNS·쇼핑몰 어디서든 우클릭으로 바로 검증할 수 있습니다.
              </p>
              <div className="mx-auto mt-10 max-w-[860px] overflow-hidden rounded-[18px] border border-white/10 bg-[#1b1b21] shadow-[0_30px_90px_rgba(0,0,0,0.6)]">
                <video
                  ref={extVideoRef}
                  src="/extension-demo.mp4"
                  muted
                  loop
                  playsInline
                  autoPlay
                  preload="auto"
                  className="block w-full bg-black"
                />
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
