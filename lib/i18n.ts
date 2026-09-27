export type Locale = "ko" | "en";

/** Server-side counterpart of components/layout/LanguageProvider's
 *  `localized()` — same signature, kept separate so backend/analysis code
 *  (route handlers, the vision pipeline) never has to import from a
 *  "use client" component file. */
export function t(locale: Locale, ko: string, en: string): string {
  return locale === "en" ? en : ko;
}
