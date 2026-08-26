import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp: native addon, can't be bundled.
  // ws: pulled in transitively by @supabase/realtime-js (we never use
  // realtime subscriptions, just Storage/Postgrest) — its permessage-deflate
  // module does a runtime `require("zlib")`/`require("fs")` that the bundler
  // can't resolve, producing the harmless-but-noisy "Couldn't load fs/zlib"
  // console warnings. Marking it external makes Next.js `require()` it
  // natively at runtime instead of trying to bundle it, which silences that.
  serverExternalPackages: ["sharp", "ws"],

  // sharp가 배포 환경에서 로드되지 않던 문제의 수정.
  //
  // 런타임(/api/diag)이 뱉은 실제 오류:
  //   Could not load the "sharp" module using the linux-x64 runtime
  //   ERR_DLOPEN_FAILED: libvips-cpp.so.8.18.3: cannot open shared object file
  //
  // 즉 @img/sharp-linux-x64 의 .node 바이너리는 Lambda 안에 들어가 있었다(그러니
  // dlopen 까지 갔다). 없던 건 그 바이너리가 링크하는 공유 라이브러리,
  // @img/sharp-libvips-linux-x64 의 libvips-cpp.so 다. 설치 문제가 아니라 추적
  // (file tracing) 문제 — 파일 트레이서는 JS import 를 따라가지 서드파티 .node 가
  // 링크한 .so 까지 따라가지는 못한다. sharp 는 플랫폼 패키지를 동적 require 로
  // 고르기 때문에 정적 분석으로는 더더욱 보이지 않는다.
  //
  // 그래서 @img 전체를 분석 라우트의 함수 번들에 강제로 포함시킨다. 키는 라우트
  // 경로 글롭, 값은 프로젝트 루트 기준 글롭이다(next/dist/docs 의 output.md 참고).
  // /api/diag 도 같이 넣어 둔 건 수정이 먹었는지 확인하는 용도 — 진단 라우트를
  // 지울 때 이 줄도 함께 지울 것.
  outputFileTracingIncludes: {
    "/api/analyze/*": ["./node_modules/@img/**/*"],
    "/api/diag": ["./node_modules/@img/**/*"],
  },
};

export default nextConfig;
