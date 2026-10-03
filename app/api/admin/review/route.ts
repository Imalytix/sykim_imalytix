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

  const { error } = await supabase
    .from("manual_review_labels")
    .upsert({ request_id, ground_truth, reviewed_at: new Date().toISOString() }, { onConflict: "request_id" });
  if (error) return NextResponse.json({ detail: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
