import type { VisionResult } from "@/types/analysis";

const DINO_SERVICE_URL = process.env.IMALYTIX_DINO_SERVICE_URL || "http://127.0.0.1:8765";

/** DINO's score is a calibrated probability from a trained classifier, not a
 *  prompted LLM's self-reported confidence — so we derive "confidence" from
 *  how far the probability sits from the 0.5 decision boundary instead of
 *  asking the model to state one. Distance >=0.35 (i.e. <15% or >85%) reads
 *  as a decisive call; the 0.15-0.35 band is a lean; anything closer to 0.5
 *  is genuinely uncertain. */
function confidenceFromProbability(p: number): "low" | "medium" | "high" {
  const distance = Math.abs(p - 0.5);
  if (distance >= 0.35) return "high";
  if (distance >= 0.15) return "medium";
  return "low";
}

export interface DinoOutcome {
  result: VisionResult;
  /** The raw 384-dim DINOv3 embedding for this image, or null when the
   *  server call failed. Not part of VisionResult on purpose — that type is
   *  shared with the 3 LLM providers and flows straight into API responses/
   *  logs, and a 384-float array doesn't belong in either. Callers that want
   *  to persist it for pgvector kNN search (lib/db/imageRecords.ts) read it
   *  from here instead. */
  embedding: number[] | null;
}

function isValidEmbedding(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every((n) => typeof n === "number" && Number.isFinite(n));
}

/**
 * 4th analysis signal alongside the 3 vision LLMs — a DINOv3 embedding fed
 * through a linear probe trained in ml/train_linear_probe.py (see
 * docs/DEV_PROGRESS_MODULE_AB.md for the training run this shipped from).
 *
 * The VisionResult half is deliberately shaped like the 3 LLMs' output
 * (provider: "dino") rather than a bespoke type: lib/analysis/aggregator.ts
 * already knows how to weight, consensus-check, and surface evidence for
 * anything in `vision_results` without caring which provider produced it.
 * Reusing that shape means the scoring integration is a single line in
 * pipeline.ts — aggregator.ts didn't need to change to pick this signal up.
 *
 * Requires `python ml/serve.py` running locally (see that file for why a
 * long-lived process instead of a subprocess-per-request). If it's not
 * reachable, this degrades the same way a failed LLM call does — returns an
 * is_mock result that aggregator.ts's `validVision` filter excludes, so a
 * missing DINO service never breaks or skews an analysis. (embedding is
 * null in that case too, so pipeline.ts's pgvector fallback search is
 * simply skipped rather than run with garbage input.)
 */
export async function analyzeWithDino(imageBuffer: Buffer): Promise<DinoOutcome> {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${DINO_SERVICE_URL}/infer`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      // fetch's BodyInit typing doesn't structurally accept Node's Buffer
      // subtype directly — a plain Uint8Array view satisfies it.
      body: new Uint8Array(imageBuffer),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
    }

    const data = (await response.json()) as { ai_probability?: unknown; embedding?: unknown };
    const probAi = Number(data.ai_probability);
    if (!Number.isFinite(probAi)) {
      throw new Error("추론 서버가 유효한 ai_probability를 반환하지 않았습니다.");
    }
    // A missing/malformed embedding doesn't invalidate the classification —
    // ai_probability is what feeds the score, embedding is only used for
    // the separate duplicate-search fallback. Degrade that part alone.
    const embedding = isValidEmbedding(data.embedding) ? data.embedding : null;

    const confidence = confidenceFromProbability(probAi);
    return {
      embedding,
      result: {
        provider: "dino",
        model_name: "DINOv3 ViT-S/16 + linear probe (local, v1)",
        is_ai_generated: probAi >= 0.5,
        score: probAi,
        confidence,
        evidence: [
          {
            type: "embedding",
            label: "DINOv3 임베딩 분류기 판정",
            severity: confidence,
            description: `학습된 linear probe가 이 이미지를 ${(probAi * 100).toFixed(1)}% 확률로 AI 생성으로 판정했습니다.`,
          },
        ],
        suspicious_regions: [],
        limitations: [
          "1차 학습 모델(person/building/misc/item 각 카테고리, real 605장 + Stable Diffusion 600장)의 판정입니다 — FLUX/Midjourney 등 다른 생성기에 대한 일반화는 아직 검증되지 않았습니다.",
        ],
        error_category: null,
        // No cost/tokens (self-hosted, not billed per-call) — latency is
        // still worth recording, it's the local-inference-server analog of
        // the LLMs' network round-trip.
        latency_ms: Date.now() - startedAt,
        usage: null,
      },
    };
  } catch (error) {
    return {
      embedding: null,
      result: {
        provider: "dino",
        is_ai_generated: null,
        score: 0.5,
        confidence: "low",
        evidence: [],
        suspicious_regions: [],
        limitations: [],
        is_mock: true,
        error_message:
          error instanceof Error
            ? `DINO 추론 서버 연결 실패 (${DINO_SERVICE_URL}): ${error.message} — ml/serve.py가 실행 중인지 확인하세요.`
            : "DINO 추론 서버 연결 실패",
        error_category:
          error instanceof Error && (error.name === "AbortError" || /timed? ?out|timeout/i.test(error.message))
            ? "timeout"
            : "network",
        latency_ms: Date.now() - startedAt,
        usage: null,
      },
    };
  }
}
