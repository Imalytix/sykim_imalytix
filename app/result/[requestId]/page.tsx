import Link from "next/link";
import AppFooter from "@/components/layout/AppFooter";
import AppHeader from "@/components/layout/AppHeader";
import AnalysisResultView from "@/components/results/AnalysisResultView";
import { getPublicVerificationDetail } from "@/lib/db/verification";

export const dynamic = "force-dynamic";

// Public, no-login deep link — mainly for the Chrome extension's "웹에서
// 자세히 보기" button (extension analyses are always anonymous, so there's
// no session to gate this behind). getPublicVerificationDetail only ever
// returns a row when verification_requests.user_id is null, so a logged-in
// user's saved history can't be reached through this route even if someone
// knows/guesses the request_id — see that function's comment for why.
export default async function PublicResultPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  const detail = await getPublicVerificationDetail(requestId);

  if (!detail) {
    return (
      <div className="flex min-h-screen flex-col bg-black">
        <AppHeader />
        <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
          <div className="rounded-xl border border-white/9 bg-white/[0.03] p-8 text-center text-sm text-[#9a9aa4]">
            해당 분석 기록을 찾을 수 없습니다.
            <br />
            로그인한 상태에서 분석한 기록이라면{" "}
            <Link href={`/history/${requestId}`} className="text-[#60a5fa] hover:underline">
              로그인 후 여기서
            </Link>{" "}
            확인해주세요.
            <br />
            <Link href="/" className="mt-3 inline-block text-[#60a5fa] hover:underline">
              ← 홈으로
            </Link>
          </div>
        </main>
        <AppFooter />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-black">
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <AnalysisResultView
          analysisResult={detail.analysisResult}
          previewUrl={detail.imageUrl}
          backHref="/"
          returnPath={`/result/${requestId}`}
        />
      </main>
      <AppFooter />
    </div>
  );
}
