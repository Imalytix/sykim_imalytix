"use client";

import { useEffect, useRef } from "react";
import { getScoreLabel } from "@/lib/utils/score";

interface ScoreGaugeProps {
  score: number;
  label?: string;
  size?: number;
}

// Tone-based (red/green), matching the 2026-08-01 dark-theme design handoff's
// .tone-high/.tone-low gauge — replaces the earlier monochrome-by-design
// pass. That handoff only has two tones (high/low); the middle "판단
// 불확실" band (lib/utils/score.ts's 4-tier system has one) gets a neutral
// blue-gray since it's genuinely neither a danger nor a safe signal.
function toneForScore(score: number): { ring: string; track: string; badgeBg: string; badgeText: string } {
  if (score >= 60) return { ring: "#f87171", track: "rgba(248,113,113,0.16)", badgeBg: "rgba(248,113,113,0.22)", badgeText: "#fca5a5" };
  if (score < 31) return { ring: "#4ade80", track: "rgba(74,222,128,0.14)", badgeBg: "rgba(74,222,128,0.20)", badgeText: "#86efac" };
  return { ring: "#a5adba", track: "rgba(255,255,255,0.12)", badgeBg: "rgba(255,255,255,0.14)", badgeText: "#e5e5ea" };
}

export default function ScoreGauge({ score, label, size = 200 }: ScoreGaugeProps) {
  const circleRef = useRef<SVGCircleElement | null>(null);

  // Design reference is a 120px viewBox gauge with r=52, stroke=9 — scale
  // both proportionally so other sizes keep the same ring thickness ratio.
  const radius = (52 / 120) * size;
  const strokeWidth = (9 / 120) * size;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  const clampedScore = Math.max(0, Math.min(100, score));
  const offset = circumference - (clampedScore / 100) * circumference;
  const tone = toneForScore(clampedScore);

  useEffect(() => {
    const el = circleRef.current;
    if (!el) return;
    el.style.strokeDashoffset = String(circumference);
    const frame = requestAnimationFrame(() => {
      el.style.transition = "stroke-dashoffset 0.6s ease";
      el.style.strokeDashoffset = String(offset);
    });
    return () => cancelAnimationFrame(frame);
  }, [offset, circumference]);

  return (
    <div className="flex flex-col items-center gap-3">
      <div style={{ width: size, height: size }} className="relative">
        <svg width={size} height={size} className="-rotate-90" style={{ display: "block" }}>
          <circle cx={center} cy={center} r={radius} fill="none" stroke={tone.track} strokeWidth={strokeWidth} />
          <circle
            ref={circleRef}
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={tone.ring}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference}
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
          <div className="text-[10px] text-[#9a9aa4]">AI 생성 가능성</div>
          <div className="font-[family-name:var(--font-inter)] text-[42px] leading-none font-bold tracking-tight text-[#f4f4f6]">
            {clampedScore}%
          </div>
          <div
            className="mt-1 rounded-full px-3 py-0.5 text-[13px] font-bold"
            style={{ backgroundColor: tone.badgeBg, color: tone.badgeText }}
          >
            {label ?? getScoreLabel(clampedScore)}
          </div>
        </div>
      </div>
    </div>
  );
}
