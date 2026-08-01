import type { BBox, Evidence, SuspiciousRegion, UsageInfo, VisionResult } from "@/types/analysis";
import type { VisionProvider } from "./prompts";

export function extractJsonObject(text: string): Record<string, unknown> | null {
  if (!text) return null;

  const stripped = text.replace(/<thinking>[\s\S]*?<\/thinking>/g, "").trim();

  try {
    const parsed = JSON.parse(stripped);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // fall through
  }

  const fenced = stripped.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
  if (fenced) {
    try {
      const parsed = JSON.parse(fenced[1]);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // fall through
    }
  }

  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(stripped.slice(start, end + 1));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeBbox(bbox: unknown): BBox | null {
  if (!bbox || typeof bbox !== "object") return null;
  const record = bbox as Record<string, unknown>;
  const keys = ["x1", "y1", "x2", "y2"] as const;
  const values: Partial<BBox> = {};
  for (const key of keys) {
    const num = Number(record[key]);
    if (Number.isNaN(num)) return null;
    values[key] = num;
  }
  const { x1, y1, x2, y2 } = values as BBox;
  if (x1 < 0 || y1 < 0 || x2 < 0 || y2 < 0) return null;
  if (x1 > 1 || y1 > 1 || x2 > 1 || y2 > 1) return null;
  if (x2 <= x1 || y2 <= y1) return null;
  return { x1, y1, x2, y2 };
}

const VALID_SEVERITIES = new Set(["low", "medium", "high"]);

/**
 * Models occasionally invent severity words outside our 3-level taxonomy
 * (e.g. Claude returning "critical"). Downstream UI does object-key lookups
 * keyed by severity (`severityTone[region.severity]`), so an unrecognized
 * value would silently fall through to no styling — which visually reads as
 * "unremarkable" for what the model flagged as its *most* severe case. Map
 * anything we don't recognize to "high" rather than let it understate risk.
 */
function normalizeSeverity(value: unknown): Evidence["severity"] {
  const str = String(value ?? "").toLowerCase();
  return VALID_SEVERITIES.has(str) ? (str as Evidence["severity"]) : "high";
}

function normalizeEvidence(items: unknown): Evidence[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      type: String(item.type ?? "other"),
      label: String(item.label ?? ""),
      severity: normalizeSeverity(item.severity),
      description: String(item.description ?? ""),
    }));
}

function normalizeRegions(items: unknown): SuspiciousRegion[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      label: String(item.label ?? ""),
      severity: normalizeSeverity(item.severity),
      description: String(item.description ?? ""),
      bbox: normalizeBbox(item.bbox),
    }));
}

const VALID_CONTENT_TYPES = new Set(["face", "body", "animal", "landscape", "object", "text", "other"]);

export function normalizeModelResult(
  rawResult: Record<string, unknown> | string | null,
  provider: VisionProvider,
  modelName: string,
  options: {
    isMock?: boolean;
    errorMessage?: string | null;
    errorCategory?: string | null;
    latencyMs?: number | null;
    usage?: UsageInfo | null;
  } = {},
): VisionResult {
  const { isMock = false, errorMessage = null, errorCategory = null, latencyMs = null, usage = null } = options;
  let parsed: Record<string, unknown> | null = null;
  const rawResponse = rawResult;

  if (typeof rawResult === "string") parsed = extractJsonObject(rawResult);
  else if (rawResult && typeof rawResult === "object") parsed = rawResult;

  if (parsed === null) {
    return {
      provider,
      model_name: modelName,
      is_ai_generated: null,
      score: 0.5,
      confidence: "low",
      evidence: [],
      suspicious_regions: [],
      limitations: ["모델 응답 JSON 파싱에 실패했습니다."],
      raw_response: rawResponse ?? undefined,
      is_mock: isMock,
      error_message: errorMessage,
      // A JSON-parse failure on an otherwise-successful API call (200 with
      // unparseable content) still gets a category so it's distinguishable
      // in logs from a network/auth failure, unless the caller already
      // classified this as something more specific (e.g. content_policy).
      error_category: errorCategory ?? (errorMessage ? "parse_failure" : null),
      latency_ms: latencyMs,
      usage,
    };
  }

  const rawContentType = parsed.content_type;
  const contentType =
    typeof rawContentType === "string" && VALID_CONTENT_TYPES.has(rawContentType)
      ? (rawContentType as VisionResult["content_type"])
      : null;

  const scoreValue = Number(parsed.score);
  const score = Number.isNaN(scoreValue) ? 0.5 : Math.max(0, Math.min(1, scoreValue));

  return {
    provider,
    model_name: modelName,
    is_ai_generated: typeof parsed.is_ai_generated === "boolean" ? parsed.is_ai_generated : null,
    score,
    confidence: (String(parsed.confidence ?? "low") as VisionResult["confidence"]) || "low",
    content_type: contentType,
    evidence: normalizeEvidence(parsed.evidence),
    suspicious_regions: normalizeRegions(parsed.suspicious_regions),
    limitations: Array.isArray(parsed.limitations) ? parsed.limitations.map((item) => String(item)).filter(Boolean) : [],
    raw_response: rawResponse ?? undefined,
    is_mock: isMock,
    error_message: errorMessage,
    error_category: errorCategory,
    latency_ms: latencyMs,
    usage,
  };
}

export function buildMockResponse(promptType: "quick" | "standard"): Record<string, unknown> {
  if (promptType === "quick") {
    return {
      is_ai_generated: null,
      score: 0.45,
      confidence: "low",
      evidence: [
        { type: "other", label: "Mock Vision Response", severity: "low", description: "프로토타입 모드에서 생성된 모의 응답입니다." },
      ],
      suspicious_regions: [],
      limitations: ["이 응답은 실제 API 호출이 아닌 프로토타입 모의 응답입니다."],
    };
  }
  return {
    is_ai_generated: false,
    score: 0.32,
    confidence: "low",
    evidence: [{ type: "other", label: "Mock Scene Check", severity: "low", description: "프로토타입 모드에서 모의 판정했습니다." }],
    suspicious_regions: [
      { label: "central region", severity: "low", description: "프로토타입 모드의 예시 의심 영역입니다.", bbox: { x1: 0.25, y1: 0.25, x2: 0.75, y2: 0.75 } },
    ],
    limitations: ["이 응답은 실제 API 호출이 아닌 프로토타입 모의 응답입니다."],
  };
}
