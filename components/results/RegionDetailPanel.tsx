import clsx from "clsx";
import type { SuspiciousRegion } from "@/types/analysis";

interface RegionDetailPanelProps {
  region?: SuspiciousRegion;
  regionIndex?: number;
}

const severityConfig = {
  high: { label: "위험도 높음", dot: "bg-rose-500", badge: "border-rose-200 bg-rose-50 text-rose-700", bar: "bg-rose-500", barWidth: "w-full" },
  medium: { label: "위험도 보통", dot: "bg-amber-500", badge: "border-amber-200 bg-amber-50 text-amber-700", bar: "bg-amber-400", barWidth: "w-2/3" },
  low: { label: "위험도 낮음", dot: "bg-emerald-500", badge: "border-emerald-200 bg-emerald-50 text-emerald-700", bar: "bg-emerald-400", barWidth: "w-1/3" },
};

export default function RegionDetailPanel({ region, regionIndex }: RegionDetailPanelProps) {
  if (!region) {
    return (
      <div className="rounded-2xl border border-slate-100 bg-slate-50 p-6 text-center text-sm text-slate-400">
        왼쪽 목록에서 항목을 선택하면 세부 정보가 표시됩니다.
      </div>
    );
  }

  const cfg = severityConfig[region.severity];
  const hasBbox = region.bbox && typeof region.bbox.x1 === "number" && typeof region.bbox.y1 === "number";

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">의심 부위</div>
          <div className="mt-1.5 flex items-center gap-2">
            {regionIndex !== undefined && (
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
                {regionIndex + 1}
              </span>
            )}
            <div className="text-lg font-semibold text-slate-900">{region.label}</div>
          </div>
        </div>
        <span className={clsx("shrink-0 rounded-full border px-3 py-1 text-xs font-semibold", cfg.badge)}>{cfg.label}</span>
      </div>

      <div className="mt-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">위험도</div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
          <div className={clsx("h-full rounded-full transition-all", cfg.bar, cfg.barWidth)} />
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">의심 근거</div>
        <p className="text-sm leading-6 text-slate-700">{region.description}</p>
      </div>

      {hasBbox && (
        <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">위치 좌표 (정규화)</div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono text-slate-600">
            <span>x1: {region.bbox!.x1.toFixed(3)}</span>
            <span>y1: {region.bbox!.y1.toFixed(3)}</span>
            <span>x2: {region.bbox!.x2.toFixed(3)}</span>
            <span>y2: {region.bbox!.y2.toFixed(3)}</span>
          </div>
        </div>
      )}

      <div className="mt-4 flex items-start gap-2 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
        <span className={clsx("mt-1.5 h-2 w-2 shrink-0 rounded-full", cfg.dot)} />
        <p className="text-xs leading-5 text-slate-500">
          이 부위는 이미지 내에서 AI 생성 가능성을 높이는 시각적 단서로 식별되었습니다. 판정은 확률적이며 반드시 AI 생성물임을 보장하지 않습니다.
        </p>
      </div>
    </div>
  );
}
