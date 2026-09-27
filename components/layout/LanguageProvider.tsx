"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type Locale = "ko" | "en";

type LanguageContextValue = { locale: Locale; setLocale: (locale: Locale) => void };

const LanguageContext = createContext<LanguageContextValue | null>(null);
const STORAGE_KEY = "imalytix-locale";

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<Locale>("ko");

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
