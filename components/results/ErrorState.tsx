import { AlertTriangle } from "lucide-react";
import { localized, useLanguage } from "@/components/layout/LanguageProvider";

interface ErrorStateProps {
  title?: string;
  message: string;
}

export default function ErrorState({ title, message }: ErrorStateProps) {
  const { locale } = useLanguage();
  const resolvedTitle = title ?? localized(locale, "분석에 실패했습니다.", "Analysis failed.");
  return (
    <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 p-5 text-rose-100">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 text-rose-400" />
        <div>
          <div className="font-semibold">{resolvedTitle}</div>
          <div className="mt-1 text-sm leading-6 text-rose-200/80">{message}</div>
        </div>
      </div>
    </div>
  );
}
