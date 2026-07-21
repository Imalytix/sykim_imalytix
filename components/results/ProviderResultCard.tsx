import clsx from "clsx";
import { AlertCircle, CheckCircle2, MinusCircle, TriangleAlert } from "lucide-react";
import { getConfidenceTone, toPercentageScore } from "@/lib/utils/score";
import type { Confidence } from "@/types/analysis";

interface ProviderResultCardProps {
  provider: string;
  modelName?: string;
  score: number;
  isAiGenerated: boolean | null;
  confidence: Confidence;
  evidence: string[];
  limitations?: string[];
  errorMessage?: string | null;
}

function VerdictIcon({ isAiGenerated }: { isAiGenerated: boolean | null }) {
  if (isAiGenerated === true) return <CheckCircle2 className="h-4 w-4 text-rose-500" />;
  if (isAiGenerated === false) return <MinusCircle className="h-4 w-4 text-emerald-500" />;
  return <TriangleAlert className="h-4 w-4 text-amber-500" />;
}

function verdictLabel(isAiGenerated: boolean | null) {
  if (isAiGenerated === true) return "AI 생성물 가능성 높음";
  if (isAiGenerated === false) return "실제 이미지 가능성 높음";
  return "판단 불확실";
}

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  openai: "OpenAI",
  gemini: "Gemini",
  claude: "Claude",
};

function providerDisplayName(provider: string): string {
  return PROVIDER_DISPLAY_NAMES[provider.toLowerCase()] ?? provider;
}

export default function ProviderResultCard({
  provider,
  modelName,
  score,
  isAiGenerated,
  confidence,
  evidence,
  limitations = [],
  errorMessage,
}: ProviderResultCardProps) {
  const percentage = toPercentageScore(score);

  return (
    <article className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-base font-semibold text-slate-900">{providerDisplayName(provider)}</div>
          {modelName ? <div className="mt-1 text-xs text-slate-500">{modelName}</div> : null}
        </div>
        <div className={clsx("rounded-full border px-3 py-1 text-xs font-semibold", getConfidenceTone(confidence))}>
          신뢰도 {confidence === "high" ? "높음" : confidence === "medium" ? "보통" : "낮음"}
        </div>
      </div>

      {errorMessage && (
        <div className="mt-3 flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
          <div>
            <div className="text-xs font-semibold text-rose-700">API 연동 실패</div>
            <div className="mt-0.5 text-xs text-rose-600">{errorMessage}</div>
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50">
            <VerdictIcon isAiGenerated={isAiGenerated} />
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400">판정</div>
            <div className="text-sm font-semibold text-slate-900">{verdictLabel(isAiGenerated)}</div>
          </div>
        </div>
        <div className="min-w-[128px] text-right">
          <div className="text-3xl font-semibold tracking-tight text-slate-900">{percentage}</div>
          <div className="text-xs text-slate-500">원본 값 {Number(score).toFixed(3)}</div>
        </div>
      </div>

      <div className="mt-4">
        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
          <div
            className={clsx(
              "h-full rounded-full transition-all",
              percentage >= 80 ? "bg-rose-500" : percentage >= 60 ? "bg-amber-400" : percentage >= 31 ? "bg-sky-400" : "bg-emerald-400",
            )}
            style={{ width: `${Math.max(4, percentage)}%` }}
          />
        </div>
      </div>

      {!errorMessage && (
        <div className="mt-5 space-y-4">
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">주요 근거</div>
            {evidence.length > 0 ? (
              <ul className="space-y-2 text-sm leading-6 text-slate-700">
                {evidence.slice(0, 3).map((item, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-sm text-slate-400">표시할 근거가 없습니다.</div>
            )}
          </div>

          {limitations.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">분석 한계</div>
              <ul className="space-y-2 text-sm leading-6 text-slate-500">
                {limitations.slice(0, 2).map((item, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
