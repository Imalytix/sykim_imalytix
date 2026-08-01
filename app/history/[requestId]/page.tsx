import Link from "next/link";
import { redirect } from "next/navigation";
import AppHeader from "@/components/layout/AppHeader";
import AnalysisResultView from "@/components/results/AnalysisResultView";
import { createSupabaseServerClient } from "@/lib/supabase/serverClient";
import { getVerificationDetail } from "@/lib/db/verification";

export const dynamic = "force-dynamic";

export default async function HistoryDetailPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/history/${requestId}`);
  }

  // getVerificationDetail runs every query through this session-bound client,
  // so RLS (`auth.uid() = user_id`) is what actually enforces "this request
  // belongs to me" — a request_id owned by someone else, or that doesn't
  // exist, comes back null either way (see lib/db/verification.ts's comment).
  const detail = await getVerificationDetail(supabase, requestId);

  if (!detail) {
    return (
      <div className="min-h-screen bg-[#0a0a0c]">
        <AppHeader />
        <main className="mx-auto w-full max-w-2xl px-6 py-10">
          <div className="rounded-xl border border-white/9 bg-white/[0.03] p-8 text-center text-sm text-[#9a9aa4]">
            해당 분석 기록을 찾을 수 없습니다.
            <br />
            <Link href="/history" className="mt-3 inline-block text-[#60a5fa] hover:underline">
              ← 이력으로 돌아가기
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0c]">
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl px-6 py-10">
        <AnalysisResultView analysisResult={detail.analysisResult} previewUrl={detail.imageUrl} backHref="/history" />
      </main>
    </div>
  );
}
