"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import AppHeader from "@/components/layout/AppHeader";
import { createSupabaseBrowserClient } from "@/lib/supabase/browserClient";

type Mode = "signin" | "signup";

function OAuthButton({ provider, label, className }: { provider: "google" | "kakao"; label: string; className: string }) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    // Redirects the whole browser tab away — nothing after this line runs
    // on success. app/auth/callback/route.ts is what completes the flow.
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setLoading(false);
      alert(`${label} 로그인을 시작할 수 없습니다: ${error.message}`);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={`flex h-11 w-full items-center justify-center rounded-xl text-sm font-bold transition disabled:opacity-50 ${className}`}
    >
      {loading ? "이동 중…" : label}
    </button>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackError = searchParams.get("error");

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    callbackError ? "소셜 로그인 처리 중 문제가 발생했습니다. 다시 시도해주세요." : null,
  );
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setInfoMessage(null);
    setLoading(true);
    const supabase = createSupabaseBrowserClient();

    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push("/");
        router.refresh();
      } else {
        // display_name is stored in auth.users' user_metadata here — the
        // public.users profile row's own display_name column (schema.sql's
        // handle_new_user trigger) only copies email at signup time, not
        // this. Left as a known follow-up rather than adding a second
        // trigger/update round-trip for a field this app doesn't show
        // anywhere in the UI yet.
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { display_name: displayName || null } },
        });
        if (error) throw error;
        setInfoMessage("가입 확인 이메일을 보냈습니다 — 메일함을 확인해주세요.");
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "요청을 처리할 수 없습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-6 py-16">
      <div className="text-center">
        <h1 className="text-xl font-bold text-[#f4f4f6]">{mode === "signin" ? "로그인" : "회원가입"}</h1>
        <p className="mt-1.5 text-sm text-[#9a9aa4]">
          {mode === "signin" ? "계정으로 로그인하세요." : "이메일로 새 계정을 만드세요."}
        </p>
      </div>

      <div className="flex flex-col gap-2.5">
        <OAuthButton provider="google" label="Google로 계속하기" className="border border-white/14 bg-white text-[#1a1a1a] hover:bg-white/90" />
        {/* 카카오 provider는 Supabase 대시보드에서 아직 활성화 전이라 잠시 숨김
            (구글부터 해결 후 다시 켤 예정) — 코드는 그대로 두고 주석만 처리. */}
        {/* <OAuthButton provider="kakao" label="카카오로 계속하기" className="bg-[#FEE500] text-[#1a1a1a] hover:brightness-95" /> */}
      </div>

      <div className="flex items-center gap-3 text-xs text-[#6b6b76]">
        <div className="h-px flex-1 bg-white/10" />
        또는
        <div className="h-px flex-1 bg-white/10" />
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {mode === "signup" && (
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="닉네임 (선택)"
            className="h-11 w-full rounded-xl border border-white/14 bg-black/20 px-4 text-sm text-[#f4f4f6] placeholder-[#6b6b76] outline-none transition focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/25"
          />
        )}
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="이메일"
          className="h-11 w-full rounded-xl border border-white/14 bg-black/20 px-4 text-sm text-[#f4f4f6] placeholder-[#6b6b76] outline-none transition focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/25"
        />
        <input
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호 (6자 이상)"
          className="h-11 w-full rounded-xl border border-white/14 bg-black/20 px-4 text-sm text-[#f4f4f6] placeholder-[#6b6b76] outline-none transition focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/25"
        />

        {errorMessage && <p className="text-[13px] text-rose-400">{errorMessage}</p>}
        {infoMessage && <p className="text-[13px] text-[#4ade80]">{infoMessage}</p>}

        <button
          type="submit"
          disabled={loading}
          className="mt-1 h-11 w-full rounded-xl bg-[#3b82f6] text-sm font-bold text-white shadow-[0_10px_30px_rgba(59,130,246,0.35)] transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-50"
        >
          {loading ? "처리 중…" : mode === "signin" ? "로그인" : "회원가입"}
        </button>
      </form>

      <button
        type="button"
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setErrorMessage(null);
          setInfoMessage(null);
        }}
        className="text-center text-[13px] text-[#9a9aa4] hover:text-[#f4f4f6]"
      >
        {mode === "signin" ? "계정이 없으신가요? 회원가입" : "이미 계정이 있으신가요? 로그인"}
      </button>

      <Link href="/" className="text-center text-[13px] text-[#6b6b76] hover:text-[#9a9aa4]">
        ← 로그인 없이 계속 사용하기
      </Link>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0c]">
      <AppHeader />
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
