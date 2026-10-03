/**
 * 로컬 전용 탐지 성능 리뷰 도구 — 절대 배포하지 않는다.
 *
 * Supabase에 쌓인 과거 분석 결과(v_review_candidates 뷰)를 전부 불러와 브라우저에
 * 이미지 그리드로 보여주고, 사람이 눈으로 보고 "실제 이미지 / AI 생성 / 애매함" 중
 * 하나를 매기면 manual_review_labels 테이블에 기록한다. 그 정답 라벨을 시스템의
 * is_ai_generated 판정과 대조해 정탐/오탐 개수와 탐지율을 실시간으로 계산해 보여준다.
 *
 * 전제: supabase/schema.sql의 manual_review_labels 테이블과 v_review_candidates
 * 뷰를 Supabase SQL Editor에서 먼저 실행해둘 것.
 *
 * 실행:
 *   node --env-file=.env.local scripts/review-tool.js
 *   (또는 npm run review)
 * 그 다음 http://localhost:4600 을 브라우저로 연다.
 *
 * 데이터셋은 서버 시작 시 한 번만 불러온다 — 실행 중에 새로 분석된 건은
 * 반영되지 않으니, 최신 상태를 보려면 서버를 재시작한다.
 */
const http = require("http");
const { createClient } = require("@supabase/supabase-js");

const PORT = Number(process.env.REVIEW_TOOL_PORT || 4600);
const BUCKET_NAME = "analyzed-images";
const STORAGE_URL_PREFIX = `supabase://${BUCKET_NAME}/`;
// 리뷰 세션이 길어질 수 있어 기본 createSignedUrl(1시간)보다 넉넉하게 잡는다.
const SIGNED_URL_TTL_SECONDS = Number(process.env.REVIEW_TOOL_URL_TTL_SECONDS || 6 * 60 * 60);

function getAdminClient() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 없습니다.");
    console.error("실행 예: node --env-file=.env.local scripts/review-tool.js");
    process.exit(1);
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

function toObjectPath(imageUrl) {
  if (!imageUrl || !imageUrl.startsWith(STORAGE_URL_PREFIX)) return null;
  return imageUrl.slice(STORAGE_URL_PREFIX.length);
}

async function loadDataset(supabase) {
  const { data: rows, error } = await supabase
    .from("v_review_candidates")
    .select("*");
  if (error) throw new Error(`v_review_candidates 조회 실패: ${error.message}`);

  const pathToRows = new Map(); // objectPath -> [row, ...] (같은 경로를 여러 요청이 가리킬 일은 없지만 방어적으로 배열)
  for (const row of rows) {
    const objectPath = toObjectPath(row.image_url);
    if (!objectPath) continue;
    if (!pathToRows.has(objectPath)) pathToRows.set(objectPath, []);
    pathToRows.get(objectPath).push(row);
  }

  const signedUrlByPath = new Map();
  const paths = Array.from(pathToRows.keys());
  // createSignedUrls는 한 번에 많은 경로를 처리할 수 있지만, 안전하게 500개씩 끊는다.
  for (let i = 0; i < paths.length; i += 500) {
    const chunk = paths.slice(i, i + 500);
    const { data, error: signError } = await supabase.storage.from(BUCKET_NAME).createSignedUrls(chunk, SIGNED_URL_TTL_SECONDS);
    if (signError) {
      console.warn(`일부 이미지 서명 URL 생성 실패: ${signError.message}`);
      continue;
    }
    for (const item of data) {
      if (item.signedUrl) signedUrlByPath.set(item.path, item.signedUrl);
    }
  }

  return rows.map((row) => {
    const objectPath = toObjectPath(row.image_url);
    return {
      request_id: row.request_id, // bigint — manual_review_labels의 FK, 라벨링 API에 그대로 보낸다
      public_request_id: row.public_request_id, // "req_..." 문자열 — 화면 표시/디버깅용
      created_at: row.created_at,
      input_type: row.input_type,
      width: row.width,
      height: row.height,
      final_score: row.final_score,
      final_label: row.final_label,
      is_ai_generated: row.is_ai_generated, // true | false | null("판단 불확실")
      confidence: row.confidence,
      ground_truth: row.ground_truth, // 기존에 리뷰했다면 'real' | 'ai_generated' | 'unsure', 아니면 null
      image_url: objectPath ? signedUrlByPath.get(objectPath) ?? null : null,
    };
  });
}

function renderPage(dataset) {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>Imalytix 탐지 성능 리뷰</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", "Malgun Gothic", sans-serif; background: #f4f4f2; color: #1a1a1a; }
  header { position: sticky; top: 0; z-index: 5; background: #fff; border-bottom: 1px solid #e2e0da; padding: 14px 20px; display: flex; flex-wrap: wrap; align-items: center; gap: 18px; }
  header h1 { font-size: 15px; margin: 0; font-weight: 700; white-space: nowrap; }
  .stats { display: flex; flex-wrap: wrap; gap: 14px; font-size: 13px; }
  .stats .stat { display: flex; flex-direction: column; gap: 1px; }
  .stats .stat strong { font-size: 17px; font-variant-numeric: tabular-nums; }
  .stats .stat span { color: #777; font-size: 11px; }
  .stats .accuracy strong { color: #1f5fae; }
  label.filter { margin-left: auto; font-size: 12.5px; color: #555; display: flex; align-items: center; gap: 6px; white-space: nowrap; }
  main { padding: 18px; display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 14px; }
  .card { background: #fff; border: 1px solid #e2e0da; border-radius: 10px; overflow: hidden; display: flex; flex-direction: column; }
  .card .thumb { aspect-ratio: 4 / 3; background: #eceae4 repeating-conic-gradient(#e4e2da 0% 25%, #eceae4 0% 50%) 50% / 16px 16px; display: flex; align-items: center; justify-content: center; }
  .card img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .card .noimg { font-size: 11px; color: #999; padding: 10px; text-align: center; }
  .card .body { padding: 10px 11px; display: flex; flex-direction: column; gap: 7px; }
  .verdict { font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .dot.ai { background: #d94f4f; } .dot.real { background: #2e7dd1; } .dot.unsure { background: #b8a200; }
  .meta { font-size: 11px; color: #888; }
  .buttons { display: flex; gap: 5px; }
  .buttons button { flex: 1; font-size: 11.5px; padding: 6px 4px; border-radius: 6px; border: 1px solid #d7d4cb; background: #faf9f6; cursor: pointer; }
  .buttons button:hover { background: #f0efe9; }
  .buttons button.active.real { background: #2e7dd1; color: #fff; border-color: #2e7dd1; }
  .buttons button.active.ai_generated { background: #d94f4f; color: #fff; border-color: #d94f4f; }
  .buttons button.active.unsure { background: #b8a200; color: #fff; border-color: #b8a200; }
  .match-flag { font-size: 10.5px; font-weight: 700; padding: 1px 6px; border-radius: 10px; width: fit-content; }
  .match-flag.correct { background: #e4f3e9; color: #1e7a42; }
  .match-flag.incorrect { background: #fbe9e8; color: #a23b3b; }
  footer { padding: 30px 20px 60px; text-align: center; color: #999; font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1>Imalytix 탐지 성능 리뷰</h1>
  <div class="stats" id="stats"></div>
  <label class="filter"><input type="checkbox" id="unreviewedOnly"> 리뷰 안 한 항목만 보기</label>
</header>
<main id="grid"></main>
<footer>로컬 전용 도구 — 배포되지 않는다. 라벨은 Supabase manual_review_labels 테이블에 저장된다.</footer>
<script>
  const DATA = ${JSON.stringify(dataset)};

  function labelText(v) {
    if (v === true) return "AI 생성";
    if (v === false) return "실제 이미지";
    return "판단 불확실";
  }
  function groundTruthMatchesSystem(gt, sys) {
    if (gt === "unsure" || sys === null) return null; // 정확도 계산에서 제외
    return (gt === "ai_generated") === sys;
  }

  function computeStats() {
    let reviewed = 0, correct = 0, incorrect = 0, excluded = 0;
    let tp = 0, fp = 0, tn = 0, fn = 0;
    for (const row of DATA) {
      if (!row.ground_truth) continue;
      reviewed++;
      const match = groundTruthMatchesSystem(row.ground_truth, row.is_ai_generated);
      if (match === null) { excluded++; continue; }
      if (match) correct++; else incorrect++;
      if (row.ground_truth === "ai_generated" && row.is_ai_generated === true) tp++;
      if (row.ground_truth === "real" && row.is_ai_generated === true) fp++;
      if (row.ground_truth === "real" && row.is_ai_generated === false) tn++;
      if (row.ground_truth === "ai_generated" && row.is_ai_generated === false) fn++;
    }
    const denom = correct + incorrect;
    const accuracy = denom > 0 ? ((correct / denom) * 100).toFixed(1) : "–";
    return { total: DATA.length, reviewed, correct, incorrect, excluded, accuracy, tp, fp, tn, fn };
  }

  function renderStats() {
    const s = computeStats();
    document.getElementById("stats").innerHTML = \`
      <div class="stat"><strong>\${s.total}</strong><span>전체 건수</span></div>
      <div class="stat"><strong>\${s.reviewed}</strong><span>리뷰 완료</span></div>
      <div class="stat accuracy"><strong>\${s.accuracy}\${s.accuracy !== "–" ? "%" : ""}</strong><span>탐지율 (정탐 \${s.correct} / 오탐 \${s.incorrect})</span></div>
      <div class="stat"><strong>\${s.excluded}</strong><span>판단불확실·애매함(제외)</span></div>
      <div class="stat"><strong>TP \${s.tp} · FP \${s.fp} · TN \${s.tn} · FN \${s.fn}</strong><span>AI생성=양성 기준 혼동행렬</span></div>
    \`;
  }

  async function setLabel(row, groundTruth, cardEl) {
    const res = await fetch("/api/label", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_id: row.request_id, ground_truth: groundTruth }),
    });
    if (!res.ok) {
      alert("저장 실패: " + (await res.text()));
      return;
    }
    row.ground_truth = groundTruth;
    renderCard(row, cardEl);
    renderStats();
    applyFilter();
  }

  function renderCard(row, el) {
    const match = row.ground_truth ? groundTruthMatchesSystem(row.ground_truth, row.is_ai_generated) : null;
    const dotClass = row.is_ai_generated === true ? "ai" : row.is_ai_generated === false ? "real" : "unsure";
    el.innerHTML = \`
      <div class="thumb">\${row.image_url ? \`<img src="\${row.image_url}" loading="lazy" alt="">\` : '<div class="noimg">이미지 없음</div>'}</div>
      <div class="body">
        <div class="verdict"><span class="dot \${dotClass}"></span>\${labelText(row.is_ai_generated)} · \${row.final_score}점</div>
        <div class="meta">\${row.public_request_id} · \${new Date(row.created_at).toLocaleString("ko-KR")}</div>
        \${match === null ? "" : \`<span class="match-flag \${match ? "correct" : "incorrect"}">\${match ? "정탐" : "오탐"}</span>\`}
        <div class="buttons">
          <button data-v="real" class="\${row.ground_truth === "real" ? "active real" : ""}">실제</button>
          <button data-v="ai_generated" class="\${row.ground_truth === "ai_generated" ? "active ai_generated" : ""}">AI생성</button>
          <button data-v="unsure" class="\${row.ground_truth === "unsure" ? "active unsure" : ""}">애매함</button>
        </div>
      </div>
    \`;
    el.querySelectorAll(".buttons button").forEach((btn) => {
      btn.addEventListener("click", () => setLabel(row, btn.dataset.v, el));
    });
  }

  function applyFilter() {
    const unreviewedOnly = document.getElementById("unreviewedOnly").checked;
    document.querySelectorAll(".card").forEach((el, i) => {
      el.style.display = unreviewedOnly && DATA[i].ground_truth ? "none" : "";
    });
  }

  function renderGrid() {
    const grid = document.getElementById("grid");
    grid.innerHTML = "";
    DATA.forEach((row) => {
      const el = document.createElement("div");
      el.className = "card";
      renderCard(row, el);
      grid.appendChild(el);
    });
  }

  document.getElementById("unreviewedOnly").addEventListener("change", applyFilter);
  renderStats();
  renderGrid();
</script>
</body>
</html>`;
}

async function main() {
  const supabase = getAdminClient();
  console.log("Supabase에서 분석 이력을 불러오는 중...");
  const dataset = await loadDataset(supabase);
  console.log(`${dataset.length}건 로드 완료.`);

  const html = renderPage(dataset);

  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (req.method === "POST" && req.url === "/api/label") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const { request_id, ground_truth } = JSON.parse(body);
          if (!request_id || !["real", "ai_generated", "unsure"].includes(ground_truth)) {
            res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("request_id와 ground_truth(real|ai_generated|unsure)가 필요합니다.");
            return;
          }
          const { error } = await supabase
            .from("manual_review_labels")
            .upsert({ request_id, ground_truth, reviewed_at: new Date().toISOString() }, { onConflict: "request_id" });
          if (error) throw error;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (error) {
          console.error("[review-tool] 라벨 저장 실패", error);
          res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
          res.end(error instanceof Error ? error.message : String(error));
        }
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  });

  // 127.0.0.1에만 바인딩 — LAN의 다른 기기에서 접근 불가.
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`\n리뷰 도구 실행 중: http://localhost:${PORT}\n(Ctrl+C로 종료)`);
  });
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("schema cache") || message.includes("Could not find the table")) {
    console.error("review-tool 실행 실패:", message);
    console.error("\n→ supabase/schema.sql을 아직 Supabase SQL Editor에서 재실행하지 않은 것 같습니다.");
    console.error("   manual_review_labels 테이블과 v_review_candidates 뷰가 DB에 없으면 이 에러가 납니다.");
    console.error("   대시보드 → SQL Editor에 supabase/schema.sql 전체를 붙여넣고 실행한 뒤 다시 시도하세요.");
  } else {
    console.error("review-tool 실행 실패:", err);
  }
  // process.exit()을 바로 부르면 아직 정리 중인 Supabase 클라이언트의 내부
  // 핸들과 경합해 Windows에서 libuv 어서션 크래시가 난다(동작엔 영향 없지만
  // 로그가 지저분해짐) — exitCode만 설정하고 이벤트 루프가 스스로 비워지게 둔다.
  process.exitCode = 1;
});
