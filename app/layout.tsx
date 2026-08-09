import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
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
        {/* Pretendard — Korean UI typeface used across the design (no Latin
            glyphs; Inter above covers numbers/Latin text and is listed second
            in the font stack in globals.css). Not on Google Fonts, so loaded
            from jsDelivr like the design mockup did. */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@1.3.9/dist/web/static/pretendard.css"
        />
      </head>
      <body className="min-h-full flex flex-col bg-[#0a0a0c] text-[#f4f4f6]">{children}</body>
    </html>
  );
}
