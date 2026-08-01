"use client";

import type { User } from "@supabase/supabase-js";
import { CircleDot } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browserClient";

type Status = "checking" | "online" | "offline";

async function checkHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch("/api/health", { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

export default function AppHeader() {
  const [status, setStatus] = useState<Status>("checking");
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    checkHealth().then((ok) => setStatus(ok ? "online" : "offline"));
  }, []);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    // Keeps this in sync across sign-in/sign-out/token-refresh without a
    // page reload — e.g. right after /login's supabase.auth.signInWithPassword()
    // resolves, this fires and the header updates on its own.
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

  const dotClass =
    status === "online" ? "text-emerald-400" : status === "offline" ? "text-rose-400" : "animate-pulse text-[#5a5a66]";

  const dotTitle = status === "online" ? "서버 연결됨" : status === "offline" ? "서버 오프라인" : "서버 확인 중";

  return (
    <header className="h-16 shrink-0 border-b border-white/6 bg-[#0a0a0c]/90 backdrop-blur">
      <div className="mx-auto flex h-full max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2 text-[18px] font-extrabold tracking-tight text-[#f4f4f6]">
          <Image src="/imalytix-icon.png" alt="" width={249} height={270} priority className="h-6 w-auto" />
          imalytix
        </Link>

        <nav className="flex items-center gap-5">
          <a href="#how-it-works" className="text-sm font-medium text-[#9a9aa4] transition-colors hover:text-[#f4f4f6]">
            기능 소개
          </a>
          {user ? (
            <>
              <Link href="/history" className="text-sm font-medium text-[#9a9aa4] transition-colors hover:text-[#f4f4f6]">
                내 분석 이력
              </Link>
              <button
                type="button"
                onClick={handleSignOut}
                title={user.email ?? undefined}
                className="text-sm font-medium text-[#9a9aa4] transition-colors hover:text-[#f4f4f6]"
              >
                로그아웃
              </button>
            </>
          ) : (
            <Link href="/login" className="text-sm font-medium text-[#9a9aa4] transition-colors hover:text-[#f4f4f6]">
              로그인
            </Link>
          )}
          <div title={dotTitle} className="flex items-center">
            <CircleDot className={`h-3.5 w-3.5 ${dotClass}`} />
          </div>
        </nav>
      </div>
    </header>
  );
}
