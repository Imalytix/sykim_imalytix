import Link from "next/link";
import { redirect } from "next/navigation";
import AppHeader from "@/components/layout/AppHeader";
import { createSupabaseServerClient } from "@/lib/supabase/serverClient";
import { getSignedImageUrls } from "@/lib/storage/imageStore";
import { clampPercent, getScoreLabel } from "@/lib/utils/score";

export const dynamic = "force-dynamic";

function toneClass(score: number): string {
  if (score >= 60) return "text-[#fca5a5]";
  if (score < 31) return "text-[#86efac]";
  return "text-[#e5e5ea]";
}

interface RequestRow {
  id: number;
  request_id: string;
  mode: string;
  input_type: string;
  status: string;
  created_at: string;
}

interface ResultRow {
  request_id: number;
  final_score: number;
  final_label: string | null;
  is_ai_generated: boolean | null;
}

interface ImageRow {
  request_id: number;
  image_url: string | null;
}

export default async function HistoryPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/history");
  }

  // Two queries instead of one PostgREST-embedded query (verification_requests
  // → verification_results) — the embed goes through a PK-is-FK relationship
  // (verification_results.request_id is both), and rather than rely on
  // exactly how PostgREST infers that shape, two plain queries joined here
  // in JS are simpler to reason about for a page this size (≤50 rows).
  const [{ data: requests, error: requestsError }, { count: totalCount }] = await Promise.all([
    supabase
      .from("verification_requests")
      .select("id, request_id, mode, input_type, status, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("verification_requests").select("id", { count: "exact", head: true }).eq("user_id", user.id),
  ]);

  const requestRows = (requests ?? []) as RequestRow[];
  const ids = requestRows.map((r) => r.id);

  const [{ data: results }, { data: images }] = await Promise.all([
    ids.length > 0
      ? supabase.from("verification_results").select("request_id, final_score, final_label, is_ai_generated").in("request_id", ids)
      : Promise.resolve({ data: [] as ResultRow[] }),
    ids.length > 0 ? supabase.from("request_images").select("request_id, image_url").in("request_id", ids) : Promise.resolve({ data: [] as ImageRow[] }),
  ]);

  const resultByRequestId = new Map((results ?? []).map((r) => [r.request_id, r as ResultRow]));
  const imageUrlByRequestId = new Map((images ?? []).map((i) => [(i as ImageRow).request_id, (i as ImageRow).image_url]));
  const signedUrlByImageUrl = await getSignedImageUrls(Array.from(imageUrlByRequestId.values()));

  return (
    <div className="min-h-screen bg-[#0a0a0c]">
      <AppHeader />
      <main className="mx-auto w-full max-w-2xl px-6 py-10">
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/9 bg-white/[0.04] p-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6b6b76]">마이페이지</p>
            <h1 className="mt-1 text-lg font-bold text-[#f4f4f6]">{user.email}</h1>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums text-[#f4f4f6]">{totalCount ?? 0}</div>
            <div className="text-xs text-[#9a9aa4]">총 분석 횟수</div>
          </div>
        </div>

        <h2 className="mt-8 text-sm font-semibold uppercase tracking-[0.15em] text-[#6b6b76]">최근 분석 이력</h2>
        <p className="mt-1 text-sm text-[#9a9aa4]">최근 50건까지 표시됩니다. 클릭하면 그때의 분석 결과를 다시 볼 수 있습니다.</p>

        {requestsError && (
          <div className="mt-6 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            이력을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.
          </div>
        )}

        {!requestsError && requestRows.length === 0 && (
          <div className="mt-10 rounded-xl border border-white/9 bg-white/[0.03] p-8 text-center text-sm text-[#9a9aa4]">
            아직 분석 이력이 없습니다.
            <br />
            <Link href="/" className="mt-3 inline-block text-[#60a5fa] hover:underline">
              이미지 분석하러 가기 →
            </Link>
          </div>
        )}

        <div className="mt-6 flex flex-col gap-2">
          {requestRows.map((req) => {
            const res = resultByRequestId.get(req.id);
            const score = res ? clampPercent(res.final_score) : null;
            const rawImageUrl = imageUrlByRequestId.get(req.id);
            const thumbUrl = rawImageUrl ? signedUrlByImageUrl.get(rawImageUrl) : null;

            return (
              <Link
                key={req.id}
                href={`/history/${req.request_id}`}
                className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3.5 transition hover:border-white/16 hover:bg-white/[0.06]"
              >
                {thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL, next/image adds no value for a 48px thumb
                  <img src={thumbUrl} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
                ) : (
                  <div className="h-11 w-11 shrink-0 rounded-lg bg-white/8" />
                )}
                <div className="flex flex-1 flex-col gap-0.5">
                  <div className="text-sm font-semibold text-[#f4f4f6]">
                    {req.status === "error" ? "분석 실패" : (res?.final_label ?? getScoreLabel(score ?? 0))}
                  </div>
                  <div className="text-xs text-[#6b6b76]">
                    {new Date(req.created_at).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })} ·{" "}
                    {req.input_type === "file_upload" ? "파일 업로드" : "URL"} · {req.mode}
                  </div>
                </div>
                {score !== null && <div className={`text-lg font-bold tabular-nums ${toneClass(score)}`}>{score}%</div>}
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}
