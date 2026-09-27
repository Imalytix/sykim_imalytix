"use client";

import { useLanguage } from "./LanguageProvider";

export default function LanguageToggle() {
  const { locale, setLocale } = useLanguage();

  return (
    <div className="flex overflow-hidden rounded-lg border border-white/20 text-xs font-bold" aria-label="Language selector">
      <button type="button" onClick={() => setLocale("ko")} aria-pressed={locale === "ko"} className={`px-2 py-1.5 ${locale === "ko" ? "bg-white text-black" : "text-white/70 hover:text-white"}`}>한</button>
      <button type="button" onClick={() => setLocale("en")} aria-pressed={locale === "en"} className={`px-2 py-1.5 ${locale === "en" ? "bg-white text-black" : "text-white/70 hover:text-white"}`}>EN</button>
    </div>
  );
}
