/**
 * Drives every image in test-data/images/ through POST /api/analyze/image
 * against a running dev/prod server, measuring latency and recording the
 * outcome (score, per-provider errors, or the expected validation error).
 *
 * Usage:
 *   npm run test:dataset   # generate the images once
 *   npm run dev            # in another terminal
 *   npm run test:perf      # (optionally) PERF_BASE_URL=http://localhost:3000 npm run test:perf
 */
const fs = require("fs");
const path = require("path");

const IMAGES_DIR = path.join(__dirname, "..", "test-data", "images");
const REPORT_PATH = path.join(__dirname, "..", "test-data", "report.json");
const BASE_URL = process.env.PERF_BASE_URL || "http://localhost:3000";

// Scenarios that are *supposed* to be rejected — a non-200 here is a pass, not a failure.
const EXPECT_REJECTION = new Set(["corrupt.jpg", "oversized.jpg"]);

async function analyzeOne(filePath, fileName) {
  const buffer = fs.readFileSync(filePath);
  const blob = new Blob([buffer]);
  const formData = new FormData();
  formData.append("file", blob, fileName);
  formData.append("mode", "standard");

  const startedAt = Date.now();
  let httpStatus = null;
  let body = null;
  let networkError = null;

  try {
    const res = await fetch(`${BASE_URL}/api/analyze/image`, { method: "POST", body: formData });
    httpStatus = res.status;
    body = await res.json().catch(() => null);
  } catch (error) {
    networkError = error instanceof Error ? error.message : String(error);
  }

  const durationMs = Date.now() - startedAt;
  const expectedRejection = EXPECT_REJECTION.has(fileName);

  if (networkError) {
    return { file: fileName, ok: false, durationMs, note: `network error: ${networkError}` };
  }

  if (expectedRejection) {
    return {
      file: fileName,
      ok: httpStatus !== 200,
      durationMs,
      httpStatus,
      note: httpStatus !== 200 ? `예상대로 거부됨: ${body?.detail ?? ""}` : "거부되어야 하는데 200을 반환함 (버그)",
    };
  }

  if (httpStatus !== 200) {
    return { file: fileName, ok: false, durationMs, httpStatus, note: body?.detail ?? "알 수 없는 오류" };
  }

  const providers = (body.vision_results || []).map((v) => ({
    provider: v.provider,
    score: v.score,
    confidence: v.confidence,
    error: v.error_message ?? null,
  }));
  const failedProviders = providers.filter((p) => p.error).length;

  return {
    file: fileName,
    ok: true,
    durationMs,
    httpStatus,
    ai_probability: body.final_result?.ai_probability,
    label: body.final_result?.label,
    metadata_score: body.metadata_analysis?.metadata_score,
    providers,
    note: failedProviders > 0 ? `${failedProviders}/${providers.length} providers failed` : "",
  };
}

async function main() {
  if (!fs.existsSync(IMAGES_DIR)) {
    console.error(`데이터셋이 없습니다. 먼저 실행하세요: npm run test:dataset`);
    process.exit(1);
  }

  const files = fs.readdirSync(IMAGES_DIR).filter((f) => f !== "manifest.json");
  if (files.length === 0) {
    console.error(`${IMAGES_DIR}에 이미지가 없습니다. npm run test:dataset 먼저 실행하세요.`);
    process.exit(1);
  }

  console.log(`대상 서버: ${BASE_URL}`);
  console.log(`이미지 ${files.length}개 순차 실행 중...\n`);

  const results = [];
  for (const file of files) {
    process.stdout.write(`  → ${file} ... `);
    const result = await analyzeOne(path.join(IMAGES_DIR, file), file);
    console.log(`${result.ok ? "OK" : "FAIL"} (${result.durationMs}ms)${result.note ? " — " + result.note : ""}`);
    results.push(result);
  }

  const okCount = results.filter((r) => r.ok).length;
  const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);
  const summary = {
    base_url: BASE_URL,
    ran_at: new Date().toISOString(),
    total: results.length,
    passed: okCount,
    failed: results.length - okCount,
    duration_ms: {
      min: durations[0],
      max: durations[durations.length - 1],
      median: durations[Math.floor(durations.length / 2)],
      avg: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
    },
    results,
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(summary, null, 2));

  console.log(`\n=== 요약 ===`);
  console.log(`통과: ${summary.passed}/${summary.total}`);
  console.log(`응답 시간(ms) — min ${summary.duration_ms.min} / median ${summary.duration_ms.median} / avg ${summary.duration_ms.avg} / max ${summary.duration_ms.max}`);
  console.log(`상세 리포트: ${REPORT_PATH}`);

  if (summary.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("성능 테스트 실행 실패:", err);
  process.exit(1);
});
