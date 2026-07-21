"use client";

import { CircleDot } from "lucide-react";
import Image from "next/image";
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
    status === "online" ? "text-emerald-500" : status === "offline" ? "text-rose-500" : "animate-pulse text-slate-300";

  const dotTitle = status === "online" ? "서버 연결됨" : status === "offline" ? "서버 오프라인" : "서버 확인 중";

  return (
    <header className="border-b border-slate-100 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center">
          <Image src="/imalytix-logo.png" alt="Imalytix" width={912} height={316} priority className="h-7 w-auto" />
        </Link>

        <nav className="flex items-center gap-5">
          <a href="#how-it-works" className="text-sm text-slate-500 transition-colors hover:text-slate-900">
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
