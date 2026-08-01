import clsx from "clsx";
import { AlertCircle, CheckCircle2, MinusCircle, TriangleAlert } from "lucide-react";
import { getConfidenceTone, toPercentageScore } from "@/lib/utils/score";
import type { Confidence, UsageInfo } from "@/types/analysis";

interface ProviderResultCardProps {
  provider: string;
  modelName?: string;
  score: number;
  isAiGenerated: boolean | null;
  confidence: Confidence;
  evidence: string[];
  limitations?: string[];
  errorMessage?: string | null;
  latencyMs?: number | null;
  usage?: UsageInfo | null;
}

function formatCost(usd: number): string {
  // Individual vision calls are typically fractions of a cent — 4 decimals
  // keeps that visible instead of every card silently rounding to "$0.00".
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

// Same red(high)/green(low)/gray(uncertain) tone language as ScoreGauge.tsx.
function toneFor(isAiGenerated: boolean | null): { icon: string; iconBg: string; bar: string } {
  if (isAiGenerated === true) return { icon: "#fca5a5", iconBg: "bg-[#f87171]/20", bar: "bg-[#f87171]" };
  if (isAiGenerated === false) return { icon: "#86efac", iconBg: "bg-[#4ade80]/20", bar: "bg-[#4ade80]" };
  return { icon: "#e5e5ea", iconBg: "bg-white/12", bar: "bg-[#a5adba]" };
}

function VerdictIcon({ isAiGenerated }: { isAiGenerated: boolean | null }) {
  const color = toneFor(isAiGenerated).icon;
  if (isAiGenerated === true) return <CheckCircle2 className="h-4 w-4" style={{ color }} />;
  if (isAiGenerated === false) return <MinusCircle className="h-4 w-4" style={{ color }} />;
  return <TriangleAlert className="h-4 w-4" style={{ color }} />;
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
  dino: "DINOv3",
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
  latencyMs,
  usage,
}: ProviderResultCardProps) {
  const percentage = toPercentageScore(score);
  const tone = toneFor(isAiGenerated);
  const metaParts = [
    usage?.input_tokens != null && usage?.output_tokens != null ? `${usage.input_tokens + usage.output_tokens} 토큰` : null,
    usage?.cost_usd != null ? formatCost(usage.cost_usd) : null,
    latencyMs != null ? `${(latencyMs / 1000).toFixed(1)}s` : null,
  ].filter(Boolean);

  return (
    <article className="rounded-2xl border border-white/9 bg-white/[0.04] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-base font-semibold text-[#f4f4f6]">{providerDisplayName(provider)}</div>
          {modelName ? <div className="mt-1 text-xs text-[#9a9aa4]">{modelName}</div> : null}
          {metaParts.length > 0 && <div className="mt-1 text-xs text-[#6b6b76]">{metaParts.join(" · ")}</div>}
        </div>
        <div className={clsx("rounded-full border px-3 py-1 text-xs font-semibold", getConfidenceTone(confidence))}>
          신뢰도 {confidence === "high" ? "높음" : confidence === "medium" ? "보통" : "낮음"}
        </div>
      </div>

      {errorMessage && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <div>
            <div className="text-xs font-semibold text-rose-300">API 연동 실패</div>
            <div className="mt-0.5 text-xs text-rose-300/80">{errorMessage}</div>
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={clsx("flex h-12 w-12 items-center justify-center rounded-xl", tone.iconBg)}>
            <VerdictIcon isAiGenerated={isAiGenerated} />
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-[0.2em] text-[#6b6b76]">판정</div>
            <div className="text-sm font-semibold text-[#f4f4f6]">{verdictLabel(isAiGenerated)}</div>
          </div>
        </div>
        <div className="min-w-[128px] text-right">
          <div className="font-[family-name:var(--font-inter)] text-3xl font-semibold tracking-tight text-[#f4f4f6]">{percentage}</div>
          <div className="text-xs text-[#9a9aa4]">원본 값 {Number(score).toFixed(3)}</div>
        </div>
      </div>

      <div className="mt-4">
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className={clsx("h-full rounded-full transition-all", tone.bar)} style={{ width: `${Math.max(4, percentage)}%` }} />
        </div>
      </div>

      {!errorMessage && (
        <div className="mt-5 space-y-4">
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#6b6b76]">주요 근거</div>
            {evidence.length > 0 ? (
              <ul className="space-y-2 text-sm leading-6 text-[#d4d4d9]">
                {evidence.slice(0, 3).map((item, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#6b6b76]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-sm text-[#6b6b76]">표시할 근거가 없습니다.</div>
            )}
          </div>

          {limitations.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#6b6b76]">분석 한계</div>
              <ul className="space-y-2 text-sm leading-6 text-[#9a9aa4]">
                {limitations.slice(0, 2).map((item, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#4a4a54]" />
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
