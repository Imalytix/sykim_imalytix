import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from "lucide-react";

interface RecommendationPanelProps {
  recommendedAction: string;
  limitations: string[];
  aiProbability: number;
}

function getIcon(score: number) {
  if (score >= 80) return <ShieldAlert className="h-5 w-5 text-rose-500" />;
  if (score >= 60) return <AlertTriangle className="h-5 w-5 text-amber-500" />;
  if (score >= 31) return <Info className="h-5 w-5 text-sky-500" />;
  return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
}

function getBgColor(score: number) {
  if (score >= 80) return "bg-rose-50 border-rose-200";
  if (score >= 60) return "bg-amber-50 border-amber-200";
  if (score >= 31) return "bg-sky-50 border-sky-200";
  return "bg-emerald-50 border-emerald-200";
}

function getTextColor(score: number) {
  if (score >= 80) return "text-rose-800";
  if (score >= 60) return "text-amber-800";
  if (score >= 31) return "text-sky-800";
  return "text-emerald-800";
}

export default function RecommendationPanel({ recommendedAction, limitations, aiProbability }: RecommendationPanelProps) {
  return (
    <div className="space-y-4">
      <div className={`rounded-2xl border p-5 ${getBgColor(aiProbability)}`}>
        <div className="flex items-start gap-3">
          <div className="mt-0.5 shrink-0">{getIcon(aiProbability)}</div>
          <div>
            <div className={`mb-1 text-xs font-semibold uppercase tracking-[0.2em] ${getTextColor(aiProbability)} opacity-70`}>
              권고 사항
            </div>
            <p className={`text-sm leading-6 font-medium ${getTextColor(aiProbability)}`}>{recommendedAction}</p>
          </div>
        </div>
      </div>

      {limitations.length > 0 && (
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">분석 한계</div>
          <ul className="space-y-2">
            {limitations.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm leading-6 text-slate-500">
                <span className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-slate-300" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
