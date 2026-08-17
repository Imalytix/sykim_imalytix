import Image from "next/image";
import Link from "next/link";

/** Matches the design handoff's footer — contact block + disclaimer, a small
 *  page-link row (added for About/FAQ/Privacy discoverability — Chrome Web
 *  Store and Google OAuth consent both require a reachable privacy policy
 *  link), then the large logo lockup + copyright line. */
export default function AppFooter() {
  return (
    <footer className="border-t border-white/8 bg-black px-6 py-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-10">
        <div className="flex flex-col gap-6 text-center sm:flex-row sm:items-start sm:justify-between sm:gap-20 sm:text-left">
          <div>
            <a href="mailto:imalytix@gmail.com" className="text-sm font-semibold text-white underline underline-offset-2">
              문의하기
            </a>
            <div className="mt-1 text-sm text-[#9a9aa4]">imalytix@gmail.com</div>
          </div>
          <p className="max-w-lg break-keep text-sm leading-relaxed text-[#9a9aa4] sm:text-right">
            Imalytix는 확률을 기반으로 결과를 제공합니다.{" "}
            <br className="hidden sm:block" />
            탐지 결과가 완벽하지 않을 수 있으니, 최종 판단은 신중히 내려 주시기 바랍니다.
          </p>
        </div>

        <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-medium text-[#9a9aa4] sm:justify-start">
          {/* 일반 <a> 의도적 사용 — AppHeader.tsx의 로고/Home 링크와 같은 이유(홈에서 홈 클릭 시 풀 리로드로 상태 초기화) */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className="hover:text-white">
            Home
          </a>
          <Link href="/about" className="hover:text-white">
            About us
          </Link>
          <Link href="/faq" className="hover:text-white">
            FAQ
          </Link>
          <Link href="/privacy" className="hover:text-white">
            개인정보처리방침
          </Link>
        </nav>

        <div className="flex flex-col items-center gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-center gap-3">
            <Image src="/imalytix-icon.png" alt="" width={249} height={270} className="h-10 w-auto" />
            <span className="wordmark text-4xl font-extrabold tracking-tight text-white">imalytix</span>
          </div>
          <div className="text-center text-xs text-[#6b6b76] sm:text-right">
            <div>© 2026 Imalytix AI. All rights reserved.</div>
            <div>Precision Engineering for Image Trust.</div>
          </div>
        </div>
      </div>
    </footer>
  );
}
