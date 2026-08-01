"use client";

import { FileSearch, Link2, ScanSearch, ShieldCheck, Upload } from "lucide-react";
import { useState } from "react";
import AnalysisStepsLoader from "@/components/results/AnalysisStepsLoader";
import AnalysisResultView from "@/components/results/AnalysisResultView";
import AppHeader from "@/components/layout/AppHeader";
import ImageUploader from "@/components/upload/ImageUploader";
import type { AnalysisResult } from "@/types/analysis";

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
          <AnalysisResultView analysisResult={analysisResult} previewUrl={previewUrl} errorMessage={errorMessage} onReset={handleReset} />
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
