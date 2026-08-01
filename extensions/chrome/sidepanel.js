const DEFAULT_API_BASE = "http://localhost:3000";

const els = {
  settingsBtn: document.getElementById("settingsBtn"),
  settingsPanel: document.getElementById("settingsPanel"),
  apiBaseInput: document.getElementById("apiBaseInput"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  urlInput: document.getElementById("urlInput"),
  analyzeBtn: document.getElementById("analyzeBtn"),
  emptyState: document.getElementById("emptyState"),
  loadingState: document.getElementById("loadingState"),
  errorState: document.getElementById("errorState"),
  errorMessage: document.getElementById("errorMessage"),
  errorRetryBtn: document.getElementById("errorRetryBtn"),
  resultState: document.getElementById("resultState"),
  previewImg: document.getElementById("previewImg"),
  previewTitle: document.getElementById("previewTitle"),
  gaugeArc: document.getElementById("gaugeArc"),
  gaugeScore: document.getElementById("gaugeScore"),
  gaugeVerdict: document.getElementById("gaugeVerdict"),
  gaugeSummary: document.getElementById("gaugeSummary"),
  keyFindings: document.getElementById("keyFindings"),
  reasonList: document.getElementById("reasonList"),
  interpText: document.getElementById("interpText"),
  providerRows: document.getElementById("providerRows"),
  metadataCard: document.getElementById("metadataCard"),
  newAnalysisBtn: document.getElementById("newAnalysisBtn"),
};

const PROVIDER_DISPLAY_NAMES = { openai: "OpenAI", gemini: "Gemini", claude: "Claude", dino: "DINOv3" };

// Same red(high)/green(low)/gray(uncertain) tone as toneForScore below, but
// keyed off a provider's own is_ai_generated verdict rather than a 0-100
// score — matches components/results/ProviderResultCard.tsx's toneFor().
function toneForVerdict(isAiGenerated) {
  if (isAiGenerated === true) return "#f87171";
  if (isAiGenerated === false) return "#4ade80";
  return "#a5adba";
}

function verdictLabel(isAiGenerated) {
  if (isAiGenerated === true) return "AI 생성물 가능성 높음";
  if (isAiGenerated === false) return "실제 이미지 가능성 높음";
  return "판단 불확실";
}

function formatBytes(bytes) {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCapturedAt(iso) {
  try {
    return new Date(iso).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

let lastAnalyzedUrl = null;

function showState(name) {
  for (const s of ["emptyState", "loadingState", "errorState", "resultState"]) {
    els[s].classList.toggle("hidden", s !== name);
  }
}

async function getApiBase() {
  const { imalytixApiBase } = await chrome.storage.local.get("imalytixApiBase");
  return imalytixApiBase || DEFAULT_API_BASE;
}

// final_result.ai_probability is already a 0-100 integer (see
// lib/analysis/aggregator.ts) — clamp/round only, no 0-1-vs-0-100 guessing.
// (A magnitude-based heuristic here would misread ai_probability===1 as a
// 0-1 fraction and invert it to "100%" instead of "1%" — the same bug this
// mirrors lib/utils/score.ts fixing on the web app side.)
function clampPercent(value) {
  if (value === undefined || value === null || Number.isNaN(value)) return 0;
  return Math.round(Math.max(0, Math.min(100, value)));
}

function getScoreLabel(score) {
  if (score >= 80) return "AI 생성물 가능성 높음";
  if (score >= 60) return "AI 생성 의심";
  if (score >= 31) return "판단 불확실";
  return "실제 이미지 가능성 높음";
}

// Same red(high)/green(low)/gray(uncertain) tone system as
// components/results/ScoreGauge.tsx — kept in sync by hand since this
// extension has no build step to import the React component's logic from.
function toneForScore(score) {
  if (score >= 60) return { ring: "#f87171", badgeBg: "rgba(248,113,113,0.22)", badgeText: "#fca5a5" };
  if (score < 31) return { ring: "#4ade80", badgeBg: "rgba(74,222,128,0.20)", badgeText: "#86efac" };
  return { ring: "#a5adba", badgeBg: "rgba(255,255,255,0.14)", badgeText: "#e5e5ea" };
}

function renderResult(result, sourceUrl) {
  const scorePercent = clampPercent(result.final_result.ai_probability);
  const meta = result.metadata_analysis;
  const dup = result.duplicate_check;

  els.previewImg.src = result.analyzed_image_data_url || sourceUrl;
  els.previewTitle.textContent = "이 이미지를 분석했습니다";

  // Same donut math as components/results/ScoreGauge.tsx: r=74 stroke=13 on
  // a 180 viewBox, but this SVG is drawn at 150px — the viewBox handles the
  // scaling, so the circumference below must stay keyed to r=74 (the SVG's
  // coordinate space), not the 150px rendered size.
  const r = 74;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (scorePercent / 100) * circumference;
  const tone = toneForScore(scorePercent);
  els.gaugeArc.style.stroke = tone.ring;
  els.gaugeArc.style.strokeDasharray = String(circumference);
  els.gaugeArc.style.strokeDashoffset = String(circumference);
  requestAnimationFrame(() => {
    els.gaugeArc.style.strokeDashoffset = String(offset);
  });
  els.gaugeScore.textContent = `${scorePercent}%`;
  els.gaugeVerdict.textContent = result.final_result.label || getScoreLabel(scorePercent);
  els.gaugeVerdict.style.background = tone.badgeBg;
  els.gaugeVerdict.style.color = tone.badgeText;
  els.gaugeSummary.textContent = result.recommended_action || "";

  // Mirrors app/page.tsx's keyFindings logic — kept in sync by hand (see
  // PROVIDER_DISPLAY_NAMES comment above for why this extension can't just
  // import that file directly).
  const dupMatches = dup?.matches ?? [];
  const closestMatch = dupMatches[0];
  let thirdFinding;
  if (dup?.used_cached_result && closestMatch) {
    thirdFinding = {
      ok: true,
      title: "동일한 이미지를 이전에 분석한 적이 있습니다.",
      sub: `요청 ID ${closestMatch.request_id}의 판정을 그대로 사용했습니다 (LLM 재호출 생략) — 그때 판정: ${
        closestMatch.is_ai_generated ? "AI 생성" : "실제 이미지"
      }.`,
    };
  } else if (dup?.influenced_score && closestMatch) {
    thirdFinding = {
      ok: false,
      title: `유사한 이미지 ${dupMatches.length}건이 발견되어 결과에 반영되었습니다.`,
      sub: `가장 유사한 요청 ID ${closestMatch.request_id}(${
        closestMatch.match_type === "phash" ? "픽셀 유사" : "의미적 유사"
      })의 판정(${closestMatch.is_ai_generated ? "AI 생성" : "실제 이미지"})이 이번 점수에 영향을 주었습니다.`,
    };
  } else {
    thirdFinding = {
      ok: dupMatches.length === 0,
      title: dupMatches.length === 0 ? "웹에서 동일한 이미지가 발견되지 않았습니다." : `유사한 이미지 ${dupMatches.length}건이 발견되었습니다.`,
      sub: dupMatches.length === 0 ? "이전에 분석한 이미지 중 일치하는 항목이 없습니다." : "유사도가 낮아 이번 결과에는 반영되지 않았습니다.",
    };
  }

  const findings = [
    {
      ok: Boolean(meta?.exif_found),
      title: meta?.exif_found ? "촬영 정보가 확인되었습니다." : "촬영 정보를 확인할 수 없습니다.",
      sub: meta?.exif_found ? "카메라로 촬영된 기록이 남아 있습니다." : "EXIF·촬영 기록이 이미지에 남아 있지 않습니다.",
    },
    {
      ok: Boolean(meta?.c2pa_found),
      title: meta?.c2pa_found ? "제작 이력이 확인되었습니다." : "제작 이력을 확인할 수 없습니다.",
      sub: meta?.c2pa_found ? "Content Credentials(C2PA) 서명이 포함되어 있습니다." : "제작·편집 기록(C2PA)이 이미지에 남아 있지 않습니다.",
    },
    thirdFinding,
  ];
  els.keyFindings.innerHTML = "";
  for (const f of findings) {
    const row = document.createElement("div");
    row.className = "finding-row";
    row.innerHTML = `
      <div class="finding-icon ${f.ok ? "ok" : "warn"}">${f.ok ? "✓" : "!"}</div>
      <div>
        <div class="finding-title">${f.title}</div>
        <div class="finding-sub">${f.sub}</div>
      </div>`;
    els.keyFindings.appendChild(row);
  }

  els.reasonList.innerHTML = "";
  const reasons = result.evidence_summary?.length ? result.evidence_summary.slice(0, 6) : ["표시할 근거가 없습니다."];
  for (const r of reasons) {
    const li = document.createElement("li");
    li.textContent = r;
    els.reasonList.appendChild(li);
  }

  els.interpText.textContent = result.recommended_action || "";

  renderProviders(result.vision_results ?? []);
  renderMetadata(meta);

  showState("resultState");
}

function renderProviders(visionResults) {
  els.providerRows.innerHTML = "";
  if (visionResults.length === 0) {
    els.providerRows.innerHTML = '<div class="meta-empty">표시할 비전 모델 결과가 없습니다.</div>';
    return;
  }
  for (const v of visionResults) {
    const name = PROVIDER_DISPLAY_NAMES[v.provider] ?? v.provider;
    const card = document.createElement("div");
    card.className = "provider-card";
    if (v.error_message) {
      card.innerHTML = `
        <div class="provider-card__head">
          <span class="provider-card__name">${name}</span>
        </div>
        <div class="provider-card__error">API 연동 실패: ${v.error_message}</div>`;
      els.providerRows.appendChild(card);
      continue;
    }
    const percent = clampPercent(v.score <= 1 ? v.score * 100 : v.score);
    const tone = toneForVerdict(v.is_ai_generated);
    const metaParts = [
      v.usage?.input_tokens != null && v.usage?.output_tokens != null ? `${v.usage.input_tokens + v.usage.output_tokens} 토큰` : null,
      v.latency_ms != null ? `${(v.latency_ms / 1000).toFixed(1)}s` : null,
    ].filter(Boolean);
    card.innerHTML = `
      <div class="provider-card__head">
        <span class="provider-card__name">${name}${metaParts.length ? ` · ${metaParts.join(" · ")}` : ""}</span>
        <span class="provider-card__score" style="color:${tone}">${percent}%</span>
      </div>
      <div class="provider-card__verdict">${verdictLabel(v.is_ai_generated)}</div>
      <div class="provider-card__bar"><i style="width:${Math.max(4, percent)}%;background:${tone}"></i></div>`;
    els.providerRows.appendChild(card);
  }
}

function renderMetadata(meta) {
  const rows = [];
  const camera = meta?.camera_info;
  const file = meta?.file_info;

  if (camera) {
    if (camera.make || camera.model) rows.push(["카메라", [camera.make, camera.model].filter(Boolean).join(" ")]);
    if (camera.captured_at) rows.push(["촬영 일시", formatCapturedAt(camera.captured_at)]);
    const exposure = [camera.exposure_time, camera.f_number, camera.iso ? `ISO ${camera.iso}` : null].filter(Boolean).join(" · ");
    if (exposure) rows.push(["노출", exposure]);
    rows.push(["위치 정보", camera.has_gps ? "포함" : "미포함"]);
  }
  if (file) {
    rows.push(["파일 형식", (file.format ?? "알 수 없음").toUpperCase()]);
    rows.push(["해상도", `${file.width} × ${file.height}`]);
    rows.push(["용량", formatBytes(file.size_bytes)]);
  }

  if (rows.length === 0) {
    els.metadataCard.innerHTML = '<div class="meta-empty">표시할 메타데이터가 없습니다.</div>';
    return;
  }
  els.metadataCard.innerHTML = rows
    .map(([label, value]) => `<div class="meta-row"><span class="meta-row__label">${label}</span><span class="meta-row__value">${value}</span></div>`)
    .join("");
}

async function analyze(imageUrl) {
  lastAnalyzedUrl = imageUrl;
  showState("loadingState");
  try {
    const apiBase = await getApiBase();
    const response = await fetch(`${apiBase}/api/analyze/image-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: imageUrl, mode: "standard" }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.detail || "분석에 실패했습니다.");
    renderResult(data, imageUrl);
  } catch (err) {
    els.errorMessage.textContent =
      err instanceof Error
        ? err.message
        : "분석에 실패했습니다. 분석 서버(npm run dev)가 실행 중인지, 설정의 서버 주소가 맞는지 확인해주세요.";
    showState("errorState");
  }
}

els.analyzeBtn.addEventListener("click", () => {
  const url = els.urlInput.value.trim();
  if (!url) return;
  analyze(url);
});
els.urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") els.analyzeBtn.click();
});
els.newAnalysisBtn.addEventListener("click", () => {
  els.urlInput.value = "";
  showState("emptyState");
});
els.errorRetryBtn.addEventListener("click", () => {
  if (lastAnalyzedUrl) analyze(lastAnalyzedUrl);
  else showState("emptyState");
});

els.settingsBtn.addEventListener("click", async () => {
  els.apiBaseInput.value = await getApiBase();
  els.settingsPanel.classList.toggle("hidden");
});
els.saveSettingsBtn.addEventListener("click", async () => {
  const value = els.apiBaseInput.value.trim().replace(/\/$/, "") || DEFAULT_API_BASE;
  await chrome.storage.local.set({ imalytixApiBase: value });
  els.settingsPanel.classList.add("hidden");
});

// Picks up a right-click-triggered analysis request left by background.js.
// Consumed once (removed from storage) so re-opening the panel later
// doesn't replay a stale analysis.
async function consumePendingRequest() {
  const { imalytixPendingImageUrl } = await chrome.storage.session.get("imalytixPendingImageUrl");
  if (!imalytixPendingImageUrl) return;
  await chrome.storage.session.remove(["imalytixPendingImageUrl", "imalytixPendingAt"]);
  analyze(imalytixPendingImageUrl);
}

// If the panel is already open when a new right-click comes in,
// storage.session.set() above won't be a page reload — this catches that
// case so the new request doesn't just sit unread until the next open.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "session" && changes.imalytixPendingImageUrl?.newValue) consumePendingRequest();
});

consumePendingRequest();
