"use client";

import { useEffect, useMemo, useState } from "react";

type GroundTruth = "real" | "ai_generated" | "unsure";

interface ReviewRow {
  request_id: number;
  public_request_id: string;
  created_at: string;
  input_type: string;
  width: number | null;
  height: number | null;
  final_score: number;
  final_label: string | null;
  is_ai_generated: boolean | null;
  confidence: string | null;
  ground_truth: GroundTruth | null;
  /** 'manual' = 사람이 버튼으로 매김(수정 가능). 'script' = measure-accuracy.js가
   *  이미 아는 정답으로 자동 기록(수정 불가 — 잠겨 표시됨). null = 미라벨. */
  label_source: "manual" | "script" | null;
  review_note: string | null;
  reviewed_at: string | null;
  image_url: string | null;
}

function labelText(v: boolean | null): string {
  if (v === true) return "AI 생성";
  if (v === false) return "실제 이미지";
  return "판단 불확실";
}

/** null = 정확도 계산에서 제외(시스템이 판단 불확실이었거나 리뷰어가 애매함으로 표시). */
function matchesSystem(groundTruth: GroundTruth, systemVerdict: boolean | null): boolean | null {
  if (groundTruth === "unsure" || systemVerdict === null) return null;
  return (groundTruth === "ai_generated") === systemVerdict;
}

function computeStats(rows: ReviewRow[]) {
  let reviewed = 0,
    correct = 0,
    incorrect = 0,
    excluded = 0,
    scriptLocked = 0,
    tp = 0,
    fp = 0,
    tn = 0,
    fn = 0;
  for (const row of rows) {
    if (!row.ground_truth) continue;
    reviewed++;
    if (row.label_source === "script") scriptLocked++;
    const match = matchesSystem(row.ground_truth, row.is_ai_generated);
    if (match === null) {
      excluded++;
      continue;
    }
    if (match) correct++;
    else incorrect++;
    if (row.ground_truth === "ai_generated" && row.is_ai_generated === true) tp++;
    if (row.ground_truth === "real" && row.is_ai_generated === true) fp++;
    if (row.ground_truth === "real" && row.is_ai_generated === false) tn++;
    if (row.ground_truth === "ai_generated" && row.is_ai_generated === false) fn++;
  }
  const denom = correct + incorrect;
  const accuracy = denom > 0 ? ((correct / denom) * 100).toFixed(1) : null;
  return { total: rows.length, reviewed, correct, incorrect, excluded, scriptLocked, accuracy, tp, fp, tn, fn };
}

const GROUND_TRUTH_TEXT: Record<GroundTruth, string> = { real: "실제", ai_generated: "AI생성", unsure: "애매함" };

function ReviewCard({ row, onLabel }: { row: ReviewRow; onLabel: (requestId: number, groundTruth: GroundTruth) => void }) {
  const match = row.ground_truth ? matchesSystem(row.ground_truth, row.is_ai_generated) : null;
  const dotColor = row.is_ai_generated === true ? "bg-rose-500" : row.is_ai_generated === false ? "bg-blue-500" : "bg-amber-500";
  const isLocked = row.label_source === "script";

  const buttons: { value: GroundTruth; label: string; activeClass: string }[] = [
    { value: "real", label: "실제", activeClass: "bg-blue-600 text-white border-blue-600" },
    { value: "ai_generated", label: "AI생성", activeClass: "bg-rose-600 text-white border-rose-600" },
    { value: "unsure", label: "애매함", activeClass: "bg-amber-500 text-white border-amber-500" },
  ];

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-black/10 bg-white">
      <div className="flex aspect-[4/3] items-center justify-center bg-[#eceae4]">
        {row.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- Supabase 서명 URL, next/image 이점 없는 내부 도구
          <img src={row.image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span className="p-2 text-center text-[11px] text-[#999]">이미지 없음</span>
        )}
      </div>
      <div className="flex flex-col gap-1.5 p-2.5">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#1a1a1a]">
          <span className={`h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
          {labelText(row.is_ai_generated)} · {row.final_score}점
        </div>
        <div className="text-[11px] text-[#888]">
          {row.public_request_id} · {new Date(row.created_at).toLocaleString("ko-KR")}
        </div>
        {match !== null && (
          <span className={`w-fit rounded-full px-1.5 py-0.5 text-[10.5px] font-bold ${match ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
            {match ? "정탐" : "오탐"}
          </span>
        )}
        {isLocked ? (
          <div className="flex items-center justify-between gap-2 rounded-md border border-[#d7d4cb] bg-[#f4f3ef] px-2 py-1.5 text-[11px] text-[#555]">
            <span>
              🔒 정답: <strong>{row.ground_truth ? GROUND_TRUTH_TEXT[row.ground_truth] : "-"}</strong>
            </span>
            <span className="text-[10px] text-[#999]">스크립트 자동 기록</span>
          </div>
        ) : (
          <div className="flex gap-1">
            {buttons.map((b) => (
              <button
                key={b.value}
                type="button"
                onClick={() => onLabel(row.request_id, b.value)}
                className={`flex-1 rounded-md border border-[#d7d4cb] bg-[#faf9f6] px-1 py-1.5 text-[11px] hover:bg-[#f0efe9] ${row.ground_truth === b.value ? b.activeClass : ""}`}
              >
                {b.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminReviewPage() {
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unreviewedOnly, setUnreviewedOnly] = useState(false);

  useEffect(() => {
    fetch("/api/admin/review")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.detail ?? "불러오기에 실패했습니다.");
        setRows(data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "불러오기에 실패했습니다."))
      .finally(() => setLoading(false));
  }, []);

  const stats = useMemo(() => computeStats(rows), [rows]);
  const visibleRows = unreviewedOnly ? rows.filter((r) => !r.ground_truth) : rows;

  const handleLabel = async (requestId: number, groundTruth: GroundTruth) => {
    const res = await fetch("/api/admin/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_id: requestId, ground_truth: groundTruth }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      alert(`저장 실패: ${data?.detail ?? res.status}`);
      return;
    }
    setRows((prev) => prev.map((r) => (r.request_id === requestId ? { ...r, ground_truth: groundTruth } : r)));
  };

  return (
    <div className="min-h-screen bg-[#f4f4f2] text-[#1a1a1a]">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-4 border-b border-black/10 bg-white px-5 py-3.5">
        <h1 className="whitespace-nowrap text-[15px] font-bold">Imalytix 탐지 성능 리뷰</h1>
        <div className="flex flex-wrap gap-4 text-[13px]">
          <div className="flex flex-col">
            <strong className="text-[17px] tabular-nums">{stats.reviewed}</strong>
            <span className="text-[11px] text-[#777]">
              리뷰 완료 <span className="text-[#999]">(🔒 {stats.scriptLocked}건 스크립트)</span>
            </span>
          </div>
          <div className="flex flex-col">
            <strong className="text-[17px] tabular-nums text-[#1f5fae]">{stats.accuracy ? `${stats.accuracy}%` : "–"}</strong>
            <span className="text-[11px] text-[#777]">
              탐지율 (정탐 {stats.correct} / 오탐 {stats.incorrect})
            </span>
          </div>
          <div className="flex flex-col">
            <strong className="text-[17px] tabular-nums">{stats.excluded}</strong>
            <span className="text-[11px] text-[#777]">판단불확실·애매함(제외)</span>
          </div>
          <div className="flex flex-col">
            <strong className="text-[15px] tabular-nums">
              TP {stats.tp} · FP {stats.fp} · TN {stats.tn} · FN {stats.fn}
            </strong>
            <span className="text-[11px] text-[#777]">AI생성=양성 기준 혼동행렬</span>
          </div>
        </div>
        <label className="ml-auto flex items-center gap-1.5 whitespace-nowrap text-[12.5px] text-[#555]">
          <input type="checkbox" checked={unreviewedOnly} onChange={(e) => setUnreviewedOnly(e.target.checked)} />
          리뷰 안 한 항목만 보기
        </label>
      </header>

      <main className="p-4">
        {loading && <p className="p-6 text-center text-sm text-[#888]">불러오는 중…</p>}
        {error && <p className="p-6 text-center text-sm text-rose-600">{error}</p>}
        {!loading && !error && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3.5">
            {visibleRows.map((row) => (
              <ReviewCard key={row.request_id} row={row} onLabel={handleLabel} />
            ))}
          </div>
        )}
      </main>

      <footer className="px-5 py-10 text-center text-[12px] text-[#999]">
        팀 전용 — 공유 비밀번호로 접근 제어됩니다. 라벨은 Supabase manual_review_labels 테이블에 저장됩니다.
      </footer>
    </div>
  );
}
