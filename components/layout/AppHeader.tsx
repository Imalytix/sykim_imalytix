"use client";

import type { User } from "@supabase/supabase-js";
import { UserRound } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browserClient";

/** Matches the design handoff's GNB exactly: logo, Home/About us/FAQ nav,
 *  and — depending on auth state — either "Login" + "Sign in" + "Download"
 *  or "Logout" + "Download" on the right. */
export default function AppHeader() {
  const [user, setUser] = useState<User | null>(null);

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

  return (
    <header className="h-16 shrink-0 bg-black">
      <div className="mx-auto flex h-full max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 text-[18px] font-extrabold tracking-tight text-white">
          <Image src="/imalytix-icon.png" alt="" width={249} height={270} priority className="h-6 w-auto" />
          imalytix
        </Link>

        <nav className="hidden items-center gap-8 sm:flex">
          <Link href="/" className="text-sm font-bold text-white transition-opacity hover:opacity-80">
            Home
          </Link>
          {/* About us/FAQ don't have real destinations yet — placeholders
              matching the design's nav until those pages exist. */}
          <a href="#" className="text-sm font-bold text-white transition-opacity hover:opacity-80">
            About us
          </a>
          <a href="#" className="text-sm font-bold text-white transition-opacity hover:opacity-80">
            FAQ
          </a>
        </nav>

        <div className="flex items-center gap-3">
          {user ? (
            <button type="button" onClick={handleSignOut} className="text-sm font-medium text-white transition-opacity hover:opacity-80">
              Logout
            </button>
          ) : (
            <>
              <Link href="/login" className="hidden text-sm font-medium text-white transition-opacity hover:opacity-80 sm:inline">
                Login
              </Link>
              <Link
                href="/login"
                className="flex items-center gap-1.5 rounded-lg bg-[#696969] px-3 py-1.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
              >
                <UserRound className="h-3.5 w-3.5" />
                Sign in
              </Link>
            </>
          )}
          {user && (
            <Link href="/history" className="hidden text-sm font-medium text-white transition-opacity hover:opacity-80 sm:inline">
              내 분석 이력
            </Link>
          )}
          {/* Chrome 웹스토어 등록 전까지는 실제 다운로드 링크가 없음 — 배포되면 그 URL로 교체 필요 */}
          <a
            href="#"
            className="rounded-lg bg-[#52bdff] px-3.5 py-1.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            Download
          </a>
        </div>
      </div>
    </header>
  );
}
