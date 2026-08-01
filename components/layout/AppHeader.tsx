"use client";

import { CircleDot } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

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

  useEffect(() => {
    checkHealth().then((ok) => setStatus(ok ? "online" : "offline"));
  }, []);

  const dotClass =
    status === "online" ? "text-emerald-400" : status === "offline" ? "text-rose-400" : "animate-pulse text-[#5a5a66]";

  const dotTitle = status === "online" ? "서버 연결됨" : status === "offline" ? "서버 오프라인" : "서버 확인 중";

  return (
    <header className="h-16 shrink-0 border-b border-white/6 bg-[#0a0a0c]/90 backdrop-blur">
      <div className="mx-auto flex h-full max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-1.5 text-[18px] font-extrabold tracking-tight text-[#f4f4f6]">
          <span className="text-[#3b82f6]">◉</span> imalytix
        </Link>

        <nav className="flex items-center gap-5">
          <a href="#how-it-works" className="text-sm font-medium text-[#9a9aa4] transition-colors hover:text-[#f4f4f6]">
            기능 소개
          </a>
          <div title={dotTitle} className="flex items-center">
            <CircleDot className={`h-3.5 w-3.5 ${dotClass}`} />
          </div>
        </nav>
      </div>
    </header>
  );
}
