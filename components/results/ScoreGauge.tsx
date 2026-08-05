"use client";

import { useEffect, useRef } from "react";

interface ScoreGaugeProps {
  score: number;
  size?: number;
}

// Colors extracted directly from the design handoff's Figma export (pixel-
// sampled): #52bdff blue / #ffca1a amber / #f23e3e red. Bands match its
// "AI 탐지율 판단 기준" legend exactly: 0-35% 낮음, 36-64% 중간, 65-100% 높음.
function toneForScore(score: number): { ring: string; track: string; badgeBg: string; badgeText: string; shortLabel: string } {
  if (score >= 65) return { ring: "#f23e3e", track: "rgba(242,62,62,0.12)", badgeBg: "#f23e3e", badgeText: "#ffffff", shortLabel: "높음" };
  if (score >= 36) return { ring: "#ffca1a", track: "rgba(255,202,26,0.16)", badgeBg: "#ffca1a", badgeText: "#1a1a1a", shortLabel: "중간" };
  return { ring: "#52bdff", track: "rgba(82,189,255,0.14)", badgeBg: "#52bdff", badgeText: "#ffffff", shortLabel: "낮음" };
}

export default function ScoreGauge({ score, size = 200 }: ScoreGaugeProps) {
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
          <div className="text-[10px] text-[#7a7a7a]">AI 생성 가능성</div>
          <div className="font-[family-name:var(--font-inter)] text-[36px] leading-none font-bold tracking-tight text-[#1a1a1a]">
            {clampedScore}%
          </div>
          <div className="mt-1 rounded-full px-3 py-0.5 text-[13px] font-bold" style={{ backgroundColor: tone.badgeBg, color: tone.badgeText }}>
            {tone.shortLabel}
          </div>
        </div>
      </div>
    </div>
  );
}
