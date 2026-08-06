import { Eye, FileCheck2, Layers, ScanEye, ShieldCheck, Sparkles } from "lucide-react";
import AppFooter from "@/components/layout/AppFooter";
import AppHeader from "@/components/layout/AppHeader";

// 실제 팀/제품 사진 에셋이 없어서 아이콘·그라데이션 블록으로 대체했습니다 —
// 사진 확보되면 이 페이지의 각 섹션에 바로 교체 가능합니다.

const VALUES = [
  { icon: <ShieldCheck className="h-5 w-5" />, title: "신뢰할 수 있는 판단", desc: "단정적인 결론 대신, 근거와 함께 확률로 제시해 사용자가 스스로 판단할 수 있게 돕습니다." },
  { icon: <Eye className="h-5 w-5" />, title: "투명한 분석 과정", desc: "어떤 신호로 그런 판정을 내렸는지 항상 공개합니다 — 블랙박스가 아닌 설명 가능한 결과." },
  { icon: <Sparkles className="h-5 w-5" />, title: "계속 발전하는 탐지", desc: "새로운 생성 모델이 나올 때마다 탐지 방식도 함께 업데이트합니다." },
];

const TECH = [
  { icon: <Layers className="h-5 w-5" />, title: "Fusion Engine", desc: "여러 AI 모델의 분석 결과를 융합해 하나의 모델만 봤을 때의 한계를 보완합니다." },
  { icon: <ScanEye className="h-5 w-5" />, title: "Multi-model Analysis", desc: "서로 다른 관점의 AI 모델이 이미지를 동시에 대조 분석합니다." },
  { icon: <FileCheck2 className="h-5 w-5" />, title: "Explainable Results", desc: "결과와 함께 판단 근거를 제공하여 사용자가 직접 확인하고 이해할 수 있습니다." },
];

export default function AboutPage() {
  return (
    <div className="flex min-h-screen flex-col bg-black">
      <AppHeader />

      <main className="flex-1">
        <section className="border-b border-white/6 px-6 py-20 text-center">
          <span className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3.5 py-1 text-xs font-medium text-[#9a9aa4]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#52bdff]" />
            About Imalytix
          </span>
          <h1 className="mx-auto mt-3 max-w-2xl text-3xl font-bold tracking-tight text-[#f4f4f6] sm:text-4xl">
            이미지를 믿기 어려운 시대,
            <br />
            판단의 근거를 함께 제공합니다
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-[#9a9aa4]">
            Imalytix는 AI로 생성되거나 조작된 이미지를 여러 비전 AI 모델과 포렌식 분석으로 검증하고, 그 판단의 근거까지 함께 보여주는 이미지
            검증 서비스입니다.
          </p>
        </section>

        <section className="mx-auto max-w-4xl px-6 py-20">
          <h2 className="text-center text-2xl font-extrabold tracking-tight text-[#f4f4f6]">우리가 이 서비스를 만든 이유</h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-sm leading-7 text-[#9a9aa4]">
            생성형 AI가 만들어내는 이미지는 이제 육안으로 구분하기 어려울 만큼 정교해졌습니다. 중고거래 사기, 로맨스 스캠, 가짜 뉴스 이미지처럼
            AI 생성 이미지가 실제 피해로 이어지는 사례가 늘고 있지만, 일반 사용자가 이를 확인할 방법은 마땅치 않습니다. Imalytix는 이 간극을
            메우기 위해 만들어졌습니다 — 누구나 의심스러운 이미지를 몇 초 안에, 근거와 함께 확인할 수 있도록.
          </p>

          <div className="mt-12 grid gap-5 sm:grid-cols-3">
            {VALUES.map((v) => (
              <div key={v.title} className="rounded-2xl border border-white/9 bg-white/[0.04] p-6 text-left">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[#52bdff]/15 text-[#52bdff]">{v.icon}</div>
                <div className="text-[15px] font-bold text-[#f4f4f6]">{v.title}</div>
                <p className="mt-1.5 text-sm leading-relaxed text-[#9a9aa4]">{v.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-white/6 bg-white/[0.02] px-6 py-20 text-center">
          <h2 className="text-2xl font-extrabold tracking-tight text-[#f4f4f6]">국내외 AI 전문가의 자문을 바탕으로 설계했습니다</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-[#9a9aa4]">
            탐지 모델 구조와 검증 방식은 KAIST 연구실, KT AX 전략팀과
            <br className="hidden sm:block" />
            해외 유명 대학 ML 엔지니어의 자문을 통해 설계되었습니다.
          </p>
          <div className="mx-auto mt-10 grid max-w-3xl gap-5 text-left sm:grid-cols-3">
            {TECH.map((t) => (
              <div key={t.title} className="rounded-2xl border border-white/9 bg-white/[0.04] p-7">
                <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-[#52bdff]/15 text-[#52bdff]">{t.icon}</div>
                <div className="text-[17px] font-extrabold text-[#f4f4f6]">{t.title}</div>
                <p className="mt-2 text-sm leading-relaxed text-[#9a9aa4]">{t.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="px-6 py-20 text-center">
          <h2 className="text-2xl font-extrabold tracking-tight text-[#f4f4f6]">궁금한 점이 있으신가요?</h2>
          <p className="mt-3 text-sm text-[#9a9aa4]">
            언제든{" "}
            <a href="mailto:imalytix@gmail.com" className="text-[#52bdff] underline underline-offset-2">
              imalytix@gmail.com
            </a>
            으로 연락해주세요.
          </p>
        </section>
      </main>

      <AppFooter />
    </div>
  );
}
