import clsx from "clsx";
import type { SuspiciousRegion } from "@/types/analysis";
import { isValidBBox } from "@/lib/utils/bbox";

interface SuspiciousRegionListProps {
  regions: SuspiciousRegion[];
  selectedIndex: number;
  onSelectRegion: (index: number) => void;
}

const severityTone: Record<"low" | "medium" | "high", string> = {
  low: "border-[#4ade80]/30 bg-[#4ade80]/15 text-[#86efac]",
  medium: "border-amber-400/30 bg-amber-400/15 text-amber-300",
  high: "border-[#f87171]/30 bg-[#f87171]/15 text-[#fca5a5]",
};

const severityLabel: Record<"low" | "medium" | "high", string> = {
  low: "낮음",
  medium: "보통",
  high: "높음",
};

export default function SuspiciousRegionList({ regions, selectedIndex, onSelectRegion }: SuspiciousRegionListProps) {
  return (
    <div className="space-y-3">
      {regions.map((region, index) => (
        <button
          key={`${region.label}-${index}`}
          type="button"
          onClick={() => onSelectRegion(index)}
          className={clsx(
            "w-full rounded-xl border p-4 text-left transition",
            selectedIndex === index ? "border-white/25 bg-white/[0.06]" : "border-white/8 bg-white/[0.03] hover:border-white/16",
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/12 bg-black/20 text-sm font-semibold text-[#f4f4f6]">
                {index + 1}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-[#f4f4f6]">{region.label}</span>
                  {!isValidBBox(region.bbox) && (
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-[#6b6b76]">위치 정보 없음</span>
                  )}
                </div>
                <div className="mt-1 text-xs text-[#9a9aa4]">{region.description}</div>
              </div>
            </div>
            <span className={clsx("shrink-0 rounded-full border px-3 py-1 text-xs font-medium", severityTone[region.severity])}>
              {severityLabel[region.severity]}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
