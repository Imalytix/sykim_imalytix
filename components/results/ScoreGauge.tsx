"use client";

import { useEffect, useRef } from "react";
import { getScoreLabel } from "@/lib/utils/score";

interface ScoreGaugeProps {
  score: number;
  label?: string;
  size?: number;
}

function scoreColor(score: number): string {
  if (score >= 80) return "#f43f5e";
  if (score >= 60) return "#f59e0b";
  if (score >= 31) return "#38bdf8";
  return "#34d399";
}

function scoreTrackColor(score: number): string {
  if (score >= 80) return "#ffe4e6";
  if (score >= 60) return "#fef3c7";
  if (score >= 31) return "#e0f2fe";
  return "#d1fae5";
}

export default function ScoreGauge({ score, label, size = 200 }: ScoreGaugeProps) {
  const circleRef = useRef<SVGCircleElement | null>(null);

  const radius = (size - 24) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  const clampedScore = Math.max(0, Math.min(100, score));
  const offset = circumference - (clampedScore / 100) * circumference;
  const color = scoreColor(clampedScore);
  const trackColor = scoreTrackColor(clampedScore);

  useEffect(() => {
    const el = circleRef.current;
    if (!el) return;
    el.style.strokeDashoffset = String(circumference);
    const frame = requestAnimationFrame(() => {
      el.style.transition = "stroke-dashoffset 1s cubic-bezier(0.34, 1.56, 0.64, 1)";
      el.style.strokeDashoffset = String(offset);
    });
    return () => cancelAnimationFrame(frame);
  }, [offset, circumference]);

  return (
    <div className="flex flex-col items-center gap-3">
      <div style={{ width: size, height: size }} className="relative">
        <svg width={size} height={size} className="-rotate-90" style={{ display: "block" }}>
          <circle cx={center} cy={center} r={radius} fill="none" stroke={trackColor} strokeWidth={12} />
          <circle
            ref={circleRef}
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={12}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference}
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
          <div className="text-4xl font-bold tracking-tight text-slate-900">{clampedScore}%</div>
          <div className="text-xs text-slate-400">AI 생성 가능성</div>
        </div>
      </div>

      <div
        className="rounded-full border px-4 py-1.5 text-sm font-semibold"
        style={{ color, borderColor: trackColor, backgroundColor: trackColor }}
      >
        {label ?? getScoreLabel(clampedScore)}
      </div>
    </div>
  );
}
