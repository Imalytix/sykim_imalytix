/**
 * 정답이 이미 알려진 이미지(test-data/accuracy-dataset/real · ai_generated)를
 * 전부 /api/analyze/image에 돌려서 시스템 판정과 정답을 자동으로 대조하고
 * 정확도/정밀도/재현율/혼동행렬을 계산한다.
 *
 * app/admin/review(사람이 과거 결과를 보고 O/X를 매기는 도구)와 다른 지점:
 * 여기서는 정답을 "미리" 안다(팀원이 직접 찍은 실제 사진 vs 의도적으로 생성한
 * AI/위조 사진) — 그래서 채점에 사람이 끼어들 필요가 없고, 로컬에서 스크립트
 * 하나로 끝난다. 배포가 필요 없다.
 *
 * 각 이미지를 분석한 직후, 이미 아는 정답을 manual_review_labels에
 * source='script'로 바로 써넣는다 — /admin/review 화면에도 그대로 뜨지만
 * 버튼이 잠겨 있어 사람이 다시 체크할 필요가 없다(이미 확정된 정답이므로).
 * Supabase 자격증명이 없으면 이 기록만 건너뛰고(경고만 띄움) 정확도 리포트
 * 자체는 그대로 만든다 — best-effort, 핵심 기능을 막지 않는다.
 *
 * 사용법:
 *   test-data/accuracy-dataset/real/         에 실제 사진들을 넣는다
 *   test-data/accuracy-dataset/ai_generated/ 에 AI생성·위조 사진들을 넣는다
 *   npm run dev               # 다른 터미널에서 로컬 서버 기동
 *   npm run test:accuracy
 *
 * 운영 서버 기준으로 재려면: PERF_BASE_URL=https://www.imalytix.com npm run test:accuracy
 *
 * 결과:
 *   - 터미널에 이미지별 표 + 요약
 *   - test-data/accuracy-report.md   (사람이 읽는 표 — 공유/보관용)
 *   - test-data/accuracy-report.json (이미지별 상세 원본 — 다른 스크립트에서 재사용용)
 *   - Supabase manual_review_labels (source='script') — /admin/review에 잠긴 채로 노출
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const DATASET_DIR = path.join(__dirname, "..", "test-data", "accuracy-dataset");
const JSON_REPORT_PATH = path.join(__dirname, "..", "test-data", "accuracy-report.json");
const MD_REPORT_PATH = path.join(__dirname, "..", "test-data", "accuracy-report.md");
const BASE_URL = process.env.PERF_BASE_URL || "http://localhost:3000";
const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp)$/i;

// 폴더 이름 = 정답. true면 "이 폴더의 이미지는 AI 생성/위조가 맞다".
const CATEGORIES = { real: false, ai_generated: true };

// 비용 관리용 상한 — 데이터셋이 몇백 장으로 늘어도 한 번 실행에 비전 모델
// 3종 호출을 이 숫자(real+ai_generated 합산) 넘게 쓰지 않는다. 늘리고
// 싶으면 ACCURACY_SAMPLE_SIZE 환경변수로 조정.
const MAX_SAMPLE_SIZE = Number(process.env.ACCURACY_SAMPLE_SIZE || 50);

// 이 스크립트가 보낸 요청임을 표시하는 User-Agent — 통계/디버깅용 표식으로
// verification_requests.user_agent에 남는다(현재 필터링 용도로는 안 쓰지만,
// "이 요청이 어디서 왔는지" 나중에 추적할 때 유용해 계속 붙여둔다).
const SCRIPT_USER_AGENT = "Imalytix-AccuracyScript/1.0";

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

/** 방금 분석한 요청(public request_id)에 이미 아는 정답을 source='script'로
 *  기록한다 — /admin/review에 잠긴 채로 노출되어 사람이 다시 체크할 필요가
 *  없어진다. Supabase 설정이 없거나 쓰기가 실패해도 정확도 리포트 자체는
 *  영향받지 않도록 호출부에서 에러를 삼킨다(best-effort). */
async function lockLabelInReview(supabase, publicRequestId, groundTruth) {
  const { data: request, error: lookupError } = await supabase
    .from("verification_requests")
    .select("id")
    .eq("request_id", publicRequestId)
    .maybeSingle();
  if (lookupError || !request) throw lookupError ?? new Error("verification_requests에서 요청을 찾지 못함");

  const { error: upsertError } = await supabase
    .from("manual_review_labels")
    .upsert(
      { request_id: request.id, ground_truth: groundTruth ? "ai_generated" : "real", source: "script", reviewed_at: new Date().toISOString() },
      { onConflict: "request_id" },
    );
  if (upsertError) throw upsertError;
}

function listImages(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => IMAGE_EXTENSIONS.test(f));
}

// Fisher–Yates — Array.sort(() => Math.random() - 0.5)는 분포가 한쪽으로
// 쏠리는 잘 알려진 버그가 있어 쓰지 않는다.
function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// /api/analyze/image는 IP당 10분에 RATE_LIMIT_MAX_REQUESTS(기본 20)회로
// 제한돼 있다(lib/security/rateLimit.ts — 악용 방지용, 테스트 스크립트라고
// 예외는 아니다). 수십 장을 연속으로 쏘면 20장을 넘는 순간부터 전부 429를
// 받는데, 그건 탐지 실패가 아니라 그냥 막힌 것이라 채점에 섞이면 수치가
// 왜곡된다. 429 응답엔 Retry-After 헤더가 오므로, 그 시간만큼 기다렸다가
// 같은 이미지를 다시 보낸다 — 재시도 한도(MAX_RETRIES)를 넘기면 포기하고
// 진짜 실패로 기록한다.
const MAX_429_RETRIES = 5;

async function analyzeOne(filePath, fileName) {
  const buffer = fs.readFileSync(filePath);

  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    const blob = new Blob([buffer]);
    const formData = new FormData();
    formData.append("file", blob, fileName);
    formData.append("mode", "standard");

    let res;
    try {
      res = await fetch(`${BASE_URL}/api/analyze/image`, { method: "POST", body: formData, headers: { "User-Agent": SCRIPT_USER_AGENT } });
    } catch (error) {
      // 네트워크 자체가 끊긴 경우(서버 미기동 등) — HTTP 상태 코드가 없다. 재시도해도 안 될 가능성이 높아 바로 포기.
      return { ok: false, httpStatus: null, detail: `network error: ${error instanceof Error ? error.message : String(error)}` };
    }

    if (res.status === 429 && attempt < MAX_429_RETRIES) {
      const retryAfterSeconds = Number(res.headers.get("retry-after")) || 30;
      process.stdout.write(`[레이트리밋, ${retryAfterSeconds}초 대기 후 재시도] `);
      await sleep(retryAfterSeconds * 1000 + 500); // 경계값에서 또 걸리지 않게 여유를 약간 더 둔다
      continue;
    }

    const httpStatus = res.status;
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) {
      return { ok: false, httpStatus, detail: body?.detail ?? `HTTP ${httpStatus}` };
    }
    return {
      ok: true,
      httpStatus,
      publicRequestId: body.request_id,
      is_ai_generated: body.final_result?.is_ai_generated ?? null,
      score: body.final_result?.ai_probability,
      label: body.final_result?.label,
    };
  }
}

/** 정답 vs 시스템 판정을 비교해 사람이 바로 읽을 수 있는 결과 라벨로 바꾼다. */
function outcomeFor(row) {
  if (!row.ok) return "요청실패";
  if (row.is_ai_generated === null) return "판단불확실";
  const matched = row.ground_truth_is_ai === row.is_ai_generated;
  return matched ? "정탐" : "오탐";
}

// 터미널 표 정렬용 — 한글/전각 문자는 폭 2로 센다(글자 수가 아니라 터미널에
// 실제로 차지하는 칸 수 기준으로 맞춰야 열이 어긋나지 않는다).
function visualWidth(str) {
  let width = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0);
    const isWide = (code >= 0x1100 && code <= 0x115f) || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xff00 && code <= 0xff60);
    width += isWide ? 2 : 1;
  }
  return width;
}

function padVisual(str, width) {
  const pad = Math.max(0, width - visualWidth(str));
  return str + " ".repeat(pad);
}

function printTerminalTable(rows) {
  const headers = ["파일", "정답", "상태코드", "시스템 판정", "점수", "결과"];
  const data = rows.map((row) => [
    row.file,
    row.category === "ai_generated" ? "AI생성" : "실제",
    row.httpStatus === null ? "-" : String(row.httpStatus),
    row.ok ? (row.label ?? "-") : (row.detail ?? "-"),
    row.ok && row.score !== undefined ? `${row.score}` : "-",
    outcomeFor(row),
  ]);

  const widths = headers.map((h, i) => Math.max(visualWidth(h), ...data.map((d) => visualWidth(d[i]))));

  const renderRow = (cells) => "  " + cells.map((c, i) => padVisual(c, widths[i])).join("  |  ");

  console.log(renderRow(headers));
  console.log("  " + widths.map((w) => "-".repeat(w)).join("--+--"));
  for (const d of data) console.log(renderRow(d));
}

function writeMarkdownReport(summary) {
  const { accuracy_pct, precision_pct, recall_pct, confusion, rows } = summary;
  const lines = [];
  lines.push("# Imalytix 탐지 정확도 리포트");
  lines.push("");
  lines.push(`- 실행 시각: ${summary.ran_at}`);
  lines.push(`- 대상 서버: ${summary.base_url}`);
  lines.push(`- 전체 ${summary.total}장 · 채점 ${summary.scored} · 판단불확실(제외) ${summary.uncertain} · 요청실패 ${summary.failed}`);
  lines.push("");
  lines.push("## 요약");
  lines.push("");
  lines.push("| 지표 | 값 |");
  lines.push("|---|---|");
  lines.push(`| 정확도 | ${accuracy_pct ?? "–"}% |`);
  lines.push(`| 정밀도 (Precision) | ${precision_pct ?? "–"}% |`);
  lines.push(`| 재현율 (Recall) | ${recall_pct ?? "–"}% |`);
  lines.push("");
  lines.push("## 혼동행렬 (AI생성 = 양성)");
  lines.push("");
  lines.push("| | 정답: AI생성 | 정답: 실제 |");
  lines.push("|---|---|---|");
  lines.push(`| **시스템: AI생성** | TP ${confusion.tp} | FP ${confusion.fp} |`);
  lines.push(`| **시스템: 실제** | FN ${confusion.fn} | TN ${confusion.tn} |`);
  lines.push("");
  lines.push("## 이미지별 상세");
  lines.push("");
  lines.push("| 파일 | 정답 | 요청 상태 | 시스템 판정 | 점수 | 결과 |");
  lines.push("|---|---|---|---|---|---|");
  const outcomeEmoji = { 정탐: "✅ 정탐", 오탐: "❌ 오탐", 판단불확실: "⚪ 판단불확실", 요청실패: "⚠️ 요청실패" };
  for (const row of rows) {
    const groundTruthText = row.category === "ai_generated" ? "AI생성" : "실제";
    const statusText = row.httpStatus === null ? "네트워크 오류" : String(row.httpStatus);
    const verdictText = row.ok ? (row.label ?? "-") : (row.detail ?? "-");
    const scoreText = row.ok && row.score !== undefined ? `${row.score}점` : "-";
    lines.push(`| ${row.file} | ${groundTruthText} | ${statusText} | ${verdictText} | ${scoreText} | ${outcomeEmoji[outcomeFor(row)]} |`);
  }
  lines.push("");

  fs.writeFileSync(MD_REPORT_PATH, lines.join("\n"));
}

async function main() {
  console.log(`대상 서버: ${BASE_URL}`);

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    console.warn("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY가 없어 /admin/review에 라벨을 자동 기록하지 않습니다.");
    console.warn("(정확도 리포트 자체는 그대로 생성됩니다. 자동 기록을 쓰려면 --env-file=.env.local로 실행하세요.)\n");
  }

  const pool = [];
  for (const [category, groundTruth] of Object.entries(CATEGORIES)) {
    const dir = path.join(DATASET_DIR, category);
    const files = listImages(dir);
    if (files.length === 0) {
      console.warn(`[건너뜀] ${dir}에 이미지가 없습니다.`);
      continue;
    }
    for (const file of files) pool.push({ category, groundTruth, file, dir });
  }

  if (pool.length === 0) {
    console.error(`\ntest-data/accuracy-dataset/real, .../ai_generated에 이미지를 넣고 다시 실행하세요.`);
    console.error(`폴더 사용법: test-data/accuracy-dataset/README.md 참고.`);
    process.exitCode = 1;
    return;
  }

  // real+ai_generated 합산으로 MAX_SAMPLE_SIZE 넘으면 무작위로 샘플링 —
  // 데이터셋이 몇백 장으로 늘어도 한 번 실행의 비전 모델 호출 비용이
  // 상한선 밑으로 고정된다.
  const sample = pool.length > MAX_SAMPLE_SIZE ? shuffle(pool).slice(0, MAX_SAMPLE_SIZE) : pool;
  if (pool.length > MAX_SAMPLE_SIZE) {
    console.log(`전체 ${pool.length}장 중 비용 관리를 위해 무작위로 ${MAX_SAMPLE_SIZE}장만 뽑아 실행합니다 (ACCURACY_SAMPLE_SIZE 환경변수로 조정 가능).`);
  }
  if (sample.length > 20) {
    console.log(
      `이미지 ${sample.length}장 — 서버 레이트리밋(기본 IP당 10분 20회)에 걸리면 자동으로 기다렸다가 재시도합니다(시간이 꽤 걸릴 수 있음).\n` +
        `로컬 서버로 빠르게 돌리고 싶다면 .env.local에 RATE_LIMIT_MAX_REQUESTS=200 정도로 올리고 서버를 재시작하세요.`,
    );
  }
  console.log("");

  const rows = [];
  for (const { category, groundTruth, file, dir } of sample) {
    process.stdout.write(`  → [${category}] ${file} ... `);
    const result = await analyzeOne(path.join(dir, file), file);
    if (!result.ok) {
      console.log(`요청 실패 (${result.httpStatus ?? "network"}) — ${result.detail}`);
      rows.push({ file, category, ground_truth_is_ai: groundTruth, ok: false, httpStatus: result.httpStatus, detail: result.detail });
      continue;
    }
    console.log(`HTTP ${result.httpStatus} · ${result.label} (${result.score}점)`);
    rows.push({
      file,
      category,
      ground_truth_is_ai: groundTruth,
      ok: true,
      httpStatus: result.httpStatus,
      is_ai_generated: result.is_ai_generated,
      score: result.score,
      label: result.label,
    });

    if (supabase && result.publicRequestId) {
      try {
        await lockLabelInReview(supabase, result.publicRequestId, groundTruth);
      } catch (error) {
        console.warn(`    (/admin/review 라벨 기록 실패 — 정확도 집계에는 영향 없음: ${error instanceof Error ? error.message : String(error)})`);
      }
    }
  }

  let tp = 0,
    fp = 0,
    tn = 0,
    fn = 0,
    uncertain = 0,
    failed = 0;
  for (const row of rows) {
    if (!row.ok) {
      failed++;
      continue;
    }
    if (row.is_ai_generated === null) {
      uncertain++;
      continue;
    }
    if (row.ground_truth_is_ai === true && row.is_ai_generated === true) tp++;
    if (row.ground_truth_is_ai === false && row.is_ai_generated === true) fp++;
    if (row.ground_truth_is_ai === false && row.is_ai_generated === false) tn++;
    if (row.ground_truth_is_ai === true && row.is_ai_generated === false) fn++;
  }

  const scored = tp + fp + tn + fn;
  const accuracyPct = scored > 0 ? Number((((tp + tn) / scored) * 100).toFixed(1)) : null;
  const precisionPct = tp + fp > 0 ? Number(((tp / (tp + fp)) * 100).toFixed(1)) : null;
  const recallPct = tp + fn > 0 ? Number(((tp / (tp + fn)) * 100).toFixed(1)) : null;

  const summary = {
    base_url: BASE_URL,
    ran_at: new Date().toISOString(),
    total: rows.length,
    scored,
    uncertain,
    failed,
    accuracy_pct: accuracyPct,
    precision_pct: precisionPct,
    recall_pct: recallPct,
    confusion: { tp, fp, tn, fn },
    rows,
  };

  fs.writeFileSync(JSON_REPORT_PATH, JSON.stringify(summary, null, 2));
  writeMarkdownReport(summary);

  console.log(`\n=== 이미지별 상세 ===`);
  printTerminalTable(rows);

  console.log(`\n=== 요약 ===`);
  console.log(`전체 ${summary.total}장 — 채점 ${scored} / 판단불확실(제외) ${uncertain} / 요청실패 ${failed}`);
  console.log(`정확도: ${accuracyPct ?? "–"}%  (정밀도 ${precisionPct ?? "–"}% · 재현율 ${recallPct ?? "–"}%)`);
  console.log(`혼동행렬(AI생성=양성) — TP ${tp} · FP ${fp} · TN ${tn} · FN ${fn}`);
  console.log(`\n표 리포트: ${MD_REPORT_PATH}`);
  console.log(`원본 데이터: ${JSON_REPORT_PATH}`);

  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("정확도 측정 실패:", err);
  process.exitCode = 1;
});
