"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import AppFooter from "@/components/layout/AppFooter";
import AppHeader from "@/components/layout/AppHeader";
import { createSupabaseBrowserClient } from "@/lib/supabase/browserClient";

/** Google's standard 4-color "G" mark — used on the official "Continue with
 *  Google" button style (white bg, colored G, dark text), matching the
 *  design handoff exactly. */
function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.68-3.87 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.03l2.99-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.97l2.99 2.33C4.66 5.17 6.65 3.58 9 3.58z" />
    </svg>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const callbackError = searchParams.get("error");
  const [loading, setLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    // Redirects the whole browser tab away — nothing after this line runs
    // on success. app/auth/callback/route.ts is what completes the flow.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setLoading(false);
      alert(`로그인을 시작할 수 없습니다: ${error.message}`);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 px-6 py-24 text-center">
      <h1 className="text-2xl font-bold tracking-tight text-white">로그인하고 검증 기록을 보관하세요</h1>
      <p className="text-sm text-[#9a9aa4]">언제든 이전에 확인한 이미지와 분석 결과를 다시 볼 수 있습니다.</p>

      <button
        type="button"
        onClick={handleGoogleLogin}
        disabled={loading}
        className="mt-6 flex h-12 w-full max-w-xs items-center justify-center gap-3 rounded-xl border border-black/10 bg-white text-sm font-semibold text-[#1a1a1a] shadow-sm transition hover:bg-white/90 disabled:opacity-50"
      >
        {loading ? (
          "이동 중…"
        ) : (
          <>
            <GoogleLogo /> Continue with Google
          </>
        )}
      </button>

      {callbackError && <p className="mt-2 text-[13px] text-rose-400">소셜 로그인 처리 중 문제가 발생했습니다. 다시 시도해주세요.</p>}

      <Link href="/" className="mt-4 text-[13px] text-[#6b6b76] hover:text-[#9a9aa4]">
        ← 로그인 없이 계속 사용하기
      </Link>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col bg-black">
      <AppHeader />
      <div className="flex-1">
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
      <AppFooter />
    </div>
  );
}
