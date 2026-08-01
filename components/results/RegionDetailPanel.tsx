import clsx from "clsx";
import type { SuspiciousRegion } from "@/types/analysis";

interface RegionDetailPanelProps {
  region?: SuspiciousRegion;
  regionIndex?: number;
}

const severityConfig = {
  high: { label: "위험도 높음", dot: "bg-[#f87171]", badge: "border-[#f87171]/30 bg-[#f87171]/15 text-[#fca5a5]", bar: "bg-[#f87171]", barWidth: "w-full" },
  medium: { label: "위험도 보통", dot: "bg-amber-400", badge: "border-amber-400/30 bg-amber-400/15 text-amber-300", bar: "bg-amber-400", barWidth: "w-2/3" },
  low: { label: "위험도 낮음", dot: "bg-[#4ade80]", badge: "border-[#4ade80]/30 bg-[#4ade80]/15 text-[#86efac]", bar: "bg-[#4ade80]", barWidth: "w-1/3" },
};

export default function RegionDetailPanel({ region, regionIndex }: RegionDetailPanelProps) {
  if (!region) {
    return (
      <div className="rounded-xl border border-white/8 bg-black/20 p-6 text-center text-sm text-[#6b6b76]">
        왼쪽 목록에서 항목을 선택하면 세부 정보가 표시됩니다.
      </div>
    );
  }

  const cfg = severityConfig[region.severity];
  const hasBbox = region.bbox && typeof region.bbox.x1 === "number" && typeof region.bbox.y1 === "number";

  return (
    <div className="rounded-2xl border border-white/9 bg-white/[0.04] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6b6b76]">의심 부위</div>
          <div className="mt-1.5 flex items-center gap-2">
            {regionIndex !== undefined && (
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/12 text-xs font-bold text-[#f4f4f6]">
                {regionIndex + 1}
              </span>
            )}
            <div className="text-lg font-semibold text-[#f4f4f6]">{region.label}</div>
          </div>
        </div>
        <span className={clsx("shrink-0 rounded-full border px-3 py-1 text-xs font-semibold", cfg.badge)}>{cfg.label}</span>
      </div>

      <div className="mt-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#6b6b76]">위험도</div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className={clsx("h-full rounded-full transition-all", cfg.bar, cfg.barWidth)} />
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#6b6b76]">의심 근거</div>
        <p className="text-sm leading-6 text-[#d4d4d9]">{region.description}</p>
      </div>

      {hasBbox && (
        <div className="mt-4 rounded-xl border border-white/8 bg-black/20 px-4 py-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#6b6b76]">위치 좌표 (정규화)</div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono text-[#9a9aa4]">
            <span>x1: {region.bbox!.x1.toFixed(3)}</span>
            <span>y1: {region.bbox!.y1.toFixed(3)}</span>
            <span>x2: {region.bbox!.x2.toFixed(3)}</span>
            <span>y2: {region.bbox!.y2.toFixed(3)}</span>
          </div>
        </div>
      )}

      <div className="mt-4 flex items-start gap-2 rounded-xl border border-white/8 bg-black/20 px-4 py-3">
        <span className={clsx("mt-1.5 h-2 w-2 shrink-0 rounded-full", cfg.dot)} />
        <p className="text-xs leading-5 text-[#9a9aa4]">
          이 부위는 이미지 내에서 AI 생성 가능성을 높이는 시각적 단서로 식별되었습니다. 판정은 확률적이며 반드시 AI 생성물임을 보장하지 않습니다.
        </p>
      </div>
    </div>
  );
}
