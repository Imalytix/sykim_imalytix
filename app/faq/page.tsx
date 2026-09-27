"use client";

import Link from "next/link";
import AppFooter from "@/components/layout/AppFooter";
import AppHeader from "@/components/layout/AppHeader";
import { useLanguage } from "@/components/layout/LanguageProvider";

type Faq = { q: string; a: string };

const FAQS: Record<"ko" | "en", Faq[]> = {
  ko: [
    {
      q: "Imalytix는 어떤 서비스인가요?",
      a: "업로드한 이미지가 AI로 생성되었는지, 혹은 조작·편집되었는지를 여러 AI 비전 모델과 이미지 포렌식 분석(EXIF, C2PA 등)으로 함께 검증하고, 판단 근거까지 보여드리는 이미지 검증 서비스입니다.",
    },
    {
      q: "판정 결과를 100% 믿어도 되나요?",
      a: "아니요. AI 생성 여부 판별은 확률 기반 추정이며 100% 정확하다고 단정할 수 없습니다. 결과는 참고 정보로 활용하시고, 중요한 판단(거래, 법적 증거 등)에는 추가 확인을 함께 권장드립니다.",
    },
    {
      q: "어떤 AI 모델을 사용하나요?",
      a: "OpenAI GPT-4o, Google Gemini, Anthropic Claude — 서로 다른 3개 회사의 비전 AI 모델을 함께 사용해 하나의 모델에만 의존했을 때 생기는 편향과 오탐을 줄입니다.",
    },
    {
      q: "무료인가요?",
      a: "네, 현재 이미지 검증 기능은 무료로 제공됩니다.",
    },
    {
      q: "로그인 없이도 사용할 수 있나요?",
      a: "네, 이미지 분석과 요약 결과 확인은 로그인 없이 바로 사용할 수 있습니다. 다만 provider별 상세 분석, 유사 이미지 검색 같은 자세한 분석 결과와 분석 이력 저장은 로그인 후에만 제공됩니다.",
    },
    {
      q: "업로드한 이미지는 어떻게 처리되나요?",
      a: "분석을 위해 이미지가 서버와 AI 분석 제공업체(OpenAI, Google, Anthropic)로 전송됩니다. 자세한 수집 항목·보관 기간·처리 방식은 개인정보처리방침 페이지에서 확인하실 수 있습니다.",
    },
    {
      q: "Chrome 익스텐션은 어떻게 사용하나요?",
      a: "설치 후 웹페이지의 이미지를 우클릭하면 \"Imalytix로 이 이미지 분석하기\" 메뉴가 나타납니다. 클릭 한 번으로 별도 업로드 없이 바로 분석 결과를 확인할 수 있습니다.",
    },
    {
      q: "잘못된 판정을 발견했어요. 어떻게 알려줄 수 있나요?",
      a: "분석 결과 화면 하단의 피드백 폼으로 의견을 남겨주시면 검토 후 반영합니다. imalytix@gmail.com으로 직접 연락 주셔도 됩니다.",
    },
  ],
  en: [
    {
      q: "What is Imalytix?",
      a: "Imalytix is an image verification service. It checks whether an uploaded image was AI-generated or manipulated/edited using multiple AI vision models together with image forensics (EXIF, C2PA and more), and shows you the evidence behind the verdict.",
    },
    {
      q: "Can I trust the verdict 100%?",
      a: "No. Detecting AI-generated images is a probability-based estimate and can never be guaranteed to be 100% accurate. Treat the result as reference information, and double-check before important decisions such as transactions or legal evidence.",
    },
    {
      q: "Which AI models do you use?",
      a: "We combine vision models from three different companies (OpenAI GPT-4o, Google Gemini and Anthropic Claude) to reduce the bias and false positives that come from relying on a single model.",
    },
    {
      q: "Is it free?",
      a: "Yes, image verification is currently free.",
    },
    {
      q: "Can I use it without signing in?",
      a: "Yes, you can analyze images and see the summary result without signing in. Detailed results, such as per-provider analysis and similar-image search, and saving your analysis history are available after you sign in.",
    },
    {
      q: "What happens to the images I upload?",
      a: "For analysis, images are sent to our server and to our AI analysis providers (OpenAI, Google, Anthropic). See the Privacy Policy page for what is collected, how long it is kept and how it is processed.",
    },
    {
      q: "How do I use the Chrome extension?",
      a: "After installing it, right-click any image on a web page and choose the Imalytix menu item (\"Imalytix로 이 이미지 분석하기\"). One click shows the analysis result, with no separate upload.",
    },
    {
      q: "I found a wrong verdict. How can I report it?",
      a: "Leave your feedback in the form at the bottom of the result screen and we will review it. You can also email us directly at imalytix@gmail.com.",
    },
  ],
};

export default function FaqPage() {
  const { locale } = useLanguage();
  const ko = locale === "ko";

  return (
    <div className="flex min-h-screen flex-col bg-black">
      <AppHeader />

      <main className="flex-1 px-6 py-20">
        <div className="mx-auto max-w-3xl">
          <div className="text-center">
            <h1 className="text-3xl font-bold tracking-tight text-[#f4f4f6]">{ko ? "자주 묻는 질문" : "Frequently asked questions"}</h1>
            <p className="mt-3 text-sm text-[#9a9aa4]">
              {ko ? "추가적으로 궁금하신 내용은 imalytix@gmail.com으로 문의해주세요." : "For anything else, contact us at imalytix@gmail.com."}
            </p>
          </div>

          <div className="mt-12 flex flex-col gap-3">
            {/* 언어를 바꿔도 펼쳐 둔 항목이 그대로 유지되도록 key는 인덱스로 둔다 */}
            {FAQS[locale].map((item, i) => (
              <details key={i} className="group rounded-xl border border-white/9 bg-white/[0.04] open:border-[#52bdff]/40">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-[15px] font-semibold text-[#f4f4f6]">
                  {item.q}
                  <span className="shrink-0 text-[#6b6b76] transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="px-5 pb-5 text-sm leading-relaxed text-[#9a9aa4]">{item.a}</p>
              </details>
            ))}
          </div>

          <p className="mt-10 text-center text-xs text-[#6b6b76]">
            {ko ? "데이터 처리 방식이 궁금하시면 " : "Curious how we handle your data? See our "}
            <Link href="/privacy" className="text-[#52bdff] underline underline-offset-2">
              {ko ? "개인정보처리방침" : "Privacy Policy"}
            </Link>
            {ko ? "을 확인해주세요." : "."}
          </p>
        </div>
      </main>

      <AppFooter />
    </div>
  );
}
