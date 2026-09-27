import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { LanguageProvider } from "@/components/layout/LanguageProvider";

// GA4 측정 ID. 페이지 소스에 그대로 노출되는 공개 식별자라 비밀값이 아니고,
// 그래서 환경변수로 빼지 않았다 — Vercel에 설정할 항목이 하나 줄어든다.
// (스테이징/프로덕션 데이터를 분리하고 싶어지면 그때 env로 옮기면 된다.)
const GA_MEASUREMENT_ID = "G-HZ7HBTKM6V";

// 개발 중 발생하는 조회수가 실제 통계를 오염시키지 않도록 프로덕션 빌드에서만
// 로드한다. `next dev`에서는 GA 스크립트 자체가 안 나간다.
const gaEnabled = process.env.NODE_ENV === "production";

// 가변 폰트로 로드되므로 weight를 지정하지 않으면 100–900 전 구간이 한 파일에
// 들어온다(코드에서 쓰는 500/600/700/800 모두 원본 굵기로 렌더링, 가짜 볼드 없음).
// opsz 축은 글자 크기에 맞춰 획 대비·자간을 자동 조정해, 큰 헤드라인은 더 날렵하게,
// 작은 본문은 더 또렷하게 그려 준다.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  axes: ["opsz"],
});

export const metadata: Metadata = {
  title: "imalytix",
  description: "메타데이터 분석과 시각 AI 앙상블로 이미지의 AI 생성 여부를 판별합니다.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={`${inter.variable} h-full antialiased`}>
      <head>
        {/* SUIT — fallback for Hangul only. Inter is first in the font stack
            in globals.css, so Latin/numbers render in Inter and only glyphs
            Inter lacks (Korean) fall through to SUIT. Not on Google Fonts, so
            loaded from jsDelivr. The static build is used so browsers fetch
            only the weights a page actually renders. */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/sun-typeface/SUIT@2.0.5/fonts/static/woff2/SUIT.css"
        />
      </head>
      <body className="min-h-full flex flex-col bg-[#0a0a0c] text-[#f4f4f6]">
        <LanguageProvider>
        {children}

        {/* GA4 (gtag.js) — 구글이 준 스니펫을 next/script로 옮긴 것.
            <script async>를 직접 쓰지 않는 이유: next/script가 로딩 시점을
            직접 관리하므로 async 속성이 필요 없고, App Router에서 라우트를
            이동해도 스크립트를 한 번만 싣는 걸 보장해 준다(그냥 <script>를
            넣으면 클라이언트 내비게이션마다 다시 실행될 수 있다).
            afterInteractive = 페이지가 인터랙티브해진 뒤 로드. 분석 스크립트에
            권장되는 전략으로, 첫 화면 렌더링을 막지 않는다. */}
        {gaEnabled && (
          <>
            <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`} strategy="afterInteractive" />
            <Script id="ga4-init" strategy="afterInteractive">
              {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_MEASUREMENT_ID}');`}
            </Script>
          </>
        )}
        </LanguageProvider>
      </body>
    </html>
  );
}
