"use client";

import type { User } from "@supabase/supabase-js";
import { UserRound } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browserClient";

/** GNB: logo, Home/About us/FAQ nav, and — depending on auth state — either
 *  "Sign in" (starts Google OAuth directly) + "Download", or "Logout" +
 *  "Download" on the right. */
export default function AppHeader() {
  const [user, setUser] = useState<User | null>(null);
  const [signInPending, setSignInPending] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
  };

  // "Sign in"이 /login 페이지를 거치지 않고 헤더에서 바로 구글 로그인을
  // 시작합니다 — 별도 "Login" 텍스트 링크는 같은 동작의 중복이라 제거했습니다.
  // (/login 페이지 자체는 계속 존재 — /history 등에서 "next=" 리다이렉트로
  // 진입하는 경로는 그대로 유효합니다.)
  const handleSignIn = async () => {
    setSignInPending(true);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setSignInPending(false);
      alert(`로그인을 시작할 수 없습니다: ${error.message}`);
    }
  };

  // 스크롤을 내려도 GNB가 화면 상단에 붙어 있도록 sticky. z-50은 본문 위,
  // 날아가는 데모 카드(.fly-card, z-60) 아래 — 카드는 헤더를 가로질러
  // 자유롭게 날아가는 연출이라 가리지 않는다.
  return (
    <header className="sticky top-0 z-50 h-16 shrink-0 bg-black">
      <div className="mx-auto flex h-full max-w-6xl items-center justify-between px-6 sm:grid sm:grid-cols-[1fr_auto_1fr]">
        {/* 로고/Home은 next/link가 아니라 일반 <a> — 이미 "/"에 있을 때(분석 결과
            화면 등) next/link는 같은 라우트로는 아무 것도 안 하고 넘어가서
            컴포넌트 상태(분석 결과 등)가 안 지워집니다. 진짜 새로고침으로
            항상 첫 화면 상태로 돌아가게 합니다. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 의도적으로 풀 리로드 (위 주석 참고) */}
        <a href="/" className="flex shrink-0 items-center gap-2 text-[18px] font-extrabold tracking-tight text-white">
          <Image src="/imalytix-icon.png" alt="" width={249} height={270} priority className="h-6 w-auto" />
          imalytix
        </a>

        {/* 로그인/로그아웃 상태에 따라 오른쪽 영역 너비가 달라져도(justify-between이면
            중앙 네비가 흔들림) 항상 헤더 정중앙에 고정되도록 grid 가운데 칸에 배치 */}
        <nav className="hidden items-center justify-self-center gap-8 sm:flex">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 의도적으로 풀 리로드 (위 주석 참고) */}
          <a href="/" className="text-sm font-bold text-white transition-opacity hover:opacity-80">
            Home
          </a>
          <Link href="/about" className="text-sm font-bold text-white transition-opacity hover:opacity-80">
            About us
          </Link>
          <Link href="/faq" className="text-sm font-bold text-white transition-opacity hover:opacity-80">
            FAQ
          </Link>
        </nav>

        <div className="flex items-center justify-self-end gap-3">
          {user ? (
            <button type="button" onClick={handleSignOut} className="text-sm font-medium text-white transition-opacity hover:opacity-80">
              Logout
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSignIn}
              disabled={signInPending}
              className="flex items-center gap-1.5 rounded-lg bg-[#696969] px-3 py-1.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              <UserRound className="h-3.5 w-3.5" />
              {signInPending ? "이동 중…" : "Sign in"}
            </button>
          )}
          {user && (
            <Link href="/history" className="hidden text-sm font-medium text-white transition-opacity hover:opacity-80 sm:inline">
              내 분석 이력
            </Link>
          )}
          <a
            href="https://chromewebstore.google.com/detail/imalytix-%EC%9D%B4%EB%AF%B8%EC%A7%80-%ED%83%90%EC%83%89/lkcgfkikbdaiiajjdhmbllnifmebacbn"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-[#52bdff] px-3.5 py-1.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            Download
          </a>
        </div>
      </div>
    </header>
  );
}
