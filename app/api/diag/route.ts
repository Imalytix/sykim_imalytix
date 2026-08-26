import { NextResponse } from "next/server";

export const runtime = "nodejs";
// maxDuration은 일부러 안 붙였다 — /api/health, /api/feedback처럼 이 값이 없는
// 라우트는 프로덕션에서 정상 동작하므로, 이 진단 라우트만은 확실히 살아 있어야 한다.

/**
 * 임시 진단 엔드포인트 — 배포 환경에서 어떤 모듈이 로드에 실패하는지 알아낸다.
 *
 * 왜 필요한가: 프로덕션에서 /api/analyze/image 와 /api/analyze/image-url 이
 * 모든 메서드에 대해 정적 /500 페이지로 떨어진다(X-Matched-Path: /500, Allow
 * 헤더 없음 = 함수가 호출조차 안 됨). 반면 이 둘이 import 하지 않는
 * /api/health 와 /api/feedback 은 멀쩡하다. 두 그룹의 차이는 파이프라인 체인
 * (sharp 등 네이티브 모듈 포함)을 import 하느냐 하나뿐인데, 라우트 모듈이
 * import 단계에서 죽으면 우리 코드가 한 줄도 못 돌아 오류 내용을 볼 방법이
 * 없다. Vercel 로그 접근 권한이 없으므로, 같은 모듈들을 동적 import 로 하나씩
 * 시도해서 실패 원인을 JSON 으로 되돌려 받는다.
 *
 * 원인 확정 후 이 파일은 삭제할 것.
 */
export async function GET() {
  const checks: Record<string, string> = {};

  const probe = async (name: string, load: () => Promise<unknown>) => {
    const startedAt = Date.now();
    try {
      await load();
      checks[name] = `ok (${Date.now() - startedAt}ms)`;
    } catch (error) {
      checks[name] = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
  };

  // 네이티브/서드파티 먼저 — 여기서 걸리면 그 아래 우리 모듈은 볼 필요도 없다.
  await probe("sharp", () => import("sharp"));
  await probe("exifr", () => import("exifr"));
  await probe("openai", () => import("openai"));
  await probe("@google/genai", () => import("@google/genai"));
  await probe("@anthropic-ai/sdk", () => import("@anthropic-ai/sdk"));

  // 분석 라우트가 실제로 끌어오는 체인
  await probe("lib/image/preprocess", () => import("@/lib/analysis/pipeline").then((m) => m.makeRequestId));
  await probe("lib/db/verification", () => import("@/lib/db/verification"));
  await probe("lib/storage/imageStore", () => import("@/lib/storage/imageStore"));
  await probe("lib/analysis/pipeline", () => import("@/lib/analysis/pipeline"));

  // sharp 가 로드됐다면 실제로 동작까지 하는지 — 바이너리가 있어도 libvips 가
  // 없으면 import 는 통과하고 첫 호출에서 죽는 경우가 있다.
  let sharpRuntime = "not attempted";
  try {
    const sharp = (await import("sharp")).default;
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000" } })
      .png()
      .toBuffer();
    sharpRuntime = `ok (${png.length} bytes)`;
  } catch (error) {
    sharpRuntime = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }

  // Lambda 파일시스템에 @img 패키지들이 실제로 들어와 있는지 — "설치가 안 됐다"와
  // "번들에 안 실렸다"를 구분하는 결정적 정보다. 둘은 원인도 해법도 다르다.
  const fsReport: Record<string, string[] | string> = {};
  const { readdirSync, existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  for (const base of [process.cwd(), "/var/task", join(process.cwd(), ".next/standalone")]) {
    const dir = join(base, "node_modules", "@img");
    try {
      if (!existsSync(dir)) {
        fsReport[dir] = "(없음)";
        continue;
      }
      // 각 @img 패키지 안에 실제 바이너리(.node/.so)가 있는지까지 확인 —
      // 디렉터리만 있고 알맹이가 없는 경우가 바로 이번 증상이다.
      fsReport[dir] = readdirSync(dir).map((pkg) => {
        const libDir = join(dir, pkg, "lib");
        if (!existsSync(libDir)) return `${pkg} (lib 없음)`;
        return `${pkg}/lib: ${readdirSync(libDir).join(", ") || "(빔)"}`;
      });
    } catch (error) {
      fsReport[dir] = error instanceof Error ? error.message : String(error);
    }
  }

  return NextResponse.json({
    // 이 값이 바뀌어 보이면 최신 커밋이 실제로 배포된 것 — 배포 지연과 수정
    // 실패를 구분하기 위한 표식.
    marker: "tracing-includes-v1",
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    checks,
    sharpRuntime,
    fsReport,
  });
}
