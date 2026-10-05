import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/client";
import { getSignedImageUrls } from "@/lib/storage/imageStore";

export const runtime = "nodejs";

/**
 * Backs app/admin/review/page.tsx — the team's shared tool for manually
 * labeling past analysis results (real / ai_generated / unsure) against
 * verification_results.is_ai_generated, to measure detection accuracy.
 *
 * Access control lives entirely in proxy.ts (shared-password Basic Auth on
 * the /admin/* prefix) — this route does no auth of its own, same posture
 * as a route that's only ever reached through that gate.
 */

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
  ground_truth: "real" | "ai_generated" | "unsure" | null;
  /** 'manual' = 사람이 버튼으로 매김(수정 가능). 'script' = measure-accuracy.js가
   *  이미 아는 정답으로 자동 기록(수정 불가 — UI에서 잠겨 표시됨). null = 미라벨. */
  label_source: "manual" | "script" | null;
  review_note: string | null;
  reviewed_at: string | null;
  image_url: string | null;
}

export async function GET() {
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ detail: "Supabase가 설정되지 않았습니다." }, { status: 500 });

  const { data: rows, error } = await supabase.from("v_review_candidates").select("*");
  if (error) {
    // v_review_candidates가 아직 없는 환경(schema.sql 미실행)을 바로 알아챌 수 있게 원문을 그대로 전달.
    return NextResponse.json({ detail: `v_review_candidates 조회 실패: ${error.message}` }, { status: 500 });
  }

  const signedUrlByOriginal = await getSignedImageUrls(
    rows.map((row) => row.image_url),
    6 * 60 * 60, // 리뷰 세션이 길어질 수 있어 기본 1시간보다 넉넉하게
  );

  const result: ReviewRow[] = rows.map((row) => ({
    request_id: row.request_id,
    public_request_id: row.public_request_id,
    created_at: row.created_at,
    input_type: row.input_type,
    width: row.width,
    height: row.height,
    final_score: row.final_score,
    final_label: row.final_label,
    is_ai_generated: row.is_ai_generated,
    confidence: row.confidence,
    ground_truth: row.ground_truth,
    label_source: row.label_source,
    review_note: row.review_note,
    reviewed_at: row.reviewed_at,
    image_url: row.image_url ? (signedUrlByOriginal.get(row.image_url) ?? null) : null,
  }));

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ detail: "Supabase가 설정되지 않았습니다." }, { status: 500 });

  let body: { request_id?: number; ground_truth?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: "JSON 본문이 필요합니다." }, { status: 400 });
  }

  const { request_id, ground_truth } = body;
  if (!request_id || !["real", "ai_generated", "unsure"].includes(ground_truth ?? "")) {
    return NextResponse.json({ detail: "request_id와 ground_truth(real|ai_generated|unsure)가 필요합니다." }, { status: 400 });
  }

  // measure-accuracy.js가 이미 정답을 알고 자동 기록한 라벨은 이 엔드포인트
  // (사람이 화면에서 버튼을 눌렀을 때만 호출됨)로 덮어쓸 수 없다 — 버튼을
  // disabled로 숨기는 것과 별개로, API 레벨에서도 실제로 막는다.
  const { data: existing } = await supabase.from("manual_review_labels").select("source").eq("request_id", request_id).maybeSingle();
  if (existing?.source === "script") {
    return NextResponse.json({ detail: "이 라벨은 측정 스크립트가 이미 정답으로 기록한 것이라 수정할 수 없습니다." }, { status: 403 });
  }

  const { error } = await supabase
    .from("manual_review_labels")
    .upsert({ request_id, ground_truth, source: "manual", reviewed_at: new Date().toISOString() }, { onConflict: "request_id" });
  if (error) return NextResponse.json({ detail: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
