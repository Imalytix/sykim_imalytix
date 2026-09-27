"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useState } from "react";

export type Locale = "ko" | "en";

type LanguageContextValue = { locale: Locale; setLocale: (locale: Locale) => void };

const LanguageContext = createContext<LanguageContextValue | null>(null);
const STORAGE_KEY = "imalytix-locale";

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<Locale>("ko");

  // 마운트 시 저장된 선택을 복원한다 — 이전에는 상태가 항상 "ko"로 초기화되어,
  // 새로고침이나 로그인 리디렉션처럼 이 트리가 다시 마운트될 때마다 아래
  // effect가 저장해둔 선택(localStorage/쿠키)이 무시되고 한국어로 되돌아갔다.
  // 페인트 전에 동기적으로 실행되는 useLayoutEffect라 한글이 잠깐 보였다가
  // 바뀌는 깜빡임도 없다.
  useLayoutEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "ko" || stored === "en") setLocale(stored);
    } catch {
      // localStorage가 막힌 환경(프라이빗 모드 등) — 기본값(ko)을 그대로 쓴다.
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    window.localStorage.setItem(STORAGE_KEY, locale);
    document.cookie = `${STORAGE_KEY}=${locale}; path=/; max-age=31536000; samesite=lax`;
  }, [locale]);

  return <LanguageContext.Provider value={{ locale, setLocale }}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used within LanguageProvider");
  return context;
}

export function localized(locale: Locale, ko: string, en: string) {
  return locale === "ko" ? ko : en;
}
