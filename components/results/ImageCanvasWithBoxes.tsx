"use client";

/* eslint-disable @next/next/no-img-element -- overlay boxes are positioned in %
   relative to the image's own rendered box; next/image's layout wrapper would
   fight that, so a plain <img> is simplest here. */
import clsx from "clsx";
import { useMemo, useState } from "react";
import type { SuspiciousRegion } from "@/types/analysis";
import { isValidBBox } from "@/lib/utils/bbox";

interface ImageCanvasWithBoxesProps {
  imageUrl: string;
  regions: SuspiciousRegion[];
  selectedIndex: number;
  onSelectRegion: (index: number) => void;
}

export default function ImageCanvasWithBoxes({ imageUrl, regions, selectedIndex, onSelectRegion }: ImageCanvasWithBoxesProps) {
  const [loaded, setLoaded] = useState(false);
  const validRegions = useMemo(
    () => regions.map((region, index) => ({ region, index })).filter(({ region }) => isValidBBox(region.bbox)),
    [regions],
  );

  return (
    <div className="rounded-2xl border border-white/9 bg-white/[0.04] p-3">
      <div className="relative overflow-hidden rounded-lg border border-white/8 bg-black/20">
        <img
          src={imageUrl}
          alt="분석 대상 이미지"
          className={clsx("block w-full select-none", loaded ? "opacity-100" : "opacity-90")}
          onLoad={() => setLoaded(true)}
        />

        {loaded ? (
          <div className="absolute inset-0">
            {validRegions.map(({ region, index }) => {
              const bbox = region.bbox!;
              const selected = index === selectedIndex;
              const tone =
                region.severity === "high"
                  ? "border-rose-500/90 bg-rose-500/12"
                  : region.severity === "medium"
                    ? "border-amber-500/90 bg-amber-500/12"
                    : "border-emerald-500/90 bg-emerald-500/12";

              return (
                <button
                  key={`${region.label}-${index}`}
                  type="button"
                  onClick={() => onSelectRegion(index)}
                  className={clsx(
                    "absolute rounded-lg border transition",
                    tone,
                    selected ? "ring-2 ring-[#60a5fa]/80" : "ring-1 ring-white/20 hover:ring-white/50",
                  )}
                  style={{
                    left: `${bbox.x1 * 100}%`,
                    top: `${bbox.y1 * 100}%`,
                    width: `${(bbox.x2 - bbox.x1) * 100}%`,
                    height: `${(bbox.y2 - bbox.y1) * 100}%`,
                  }}
                >
                  <span className="absolute left-2 top-2 rounded-full bg-black/80 px-2 py-1 text-[11px] font-semibold text-[#f4f4f6]">
                    {index + 1}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
