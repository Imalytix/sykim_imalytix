/**
 * GA4 커스텀 이벤트 전송 헬퍼.
 *
 * gtag.js 자체는 app/layout.tsx가 싣는데, 거기서 프로덕션 빌드에서만 로드하도록
 * 막아 뒀다. 즉 `next dev`에서는 window.gtag가 아예 존재하지 않는다. 그래서 모든
 * 전송을 아래 track()에 몰아넣고 함수 존재 여부를 확인한다 — 개발 중에 조용히
 * 무시되고, 이벤트 하나 때문에 화면이 죽는 일이 없다.
 *
 * 개인정보 규칙: 파라미터에 이미지 URL·파일명·원본 데이터를 절대 넣지 않는다.
 * 아래 이벤트들의 파라미터가 전부 열거형이나 숫자인 건 의도된 것이고, 새 파라미터를
 * 추가할 때도 같은 기준을 지킬 것. 사용자가 올린 이미지에서 유래한 문자열은
 * 무엇이든(파일명, URL, EXIF 값) 여기로 들어오면 안 된다.
 */

declare global {
  interface Window {
    gtag?: (command: "event", eventName: string, params?: Record<string, unknown>) => void;
  }
}

/** 이벤트 이름과 파라미터를 한 곳에 묶어 둬서, 호출부가 이름을 문자열로 직접
 *  쓰다가 오타를 내거나 파라미터를 빠뜨리는 걸 타입으로 막는다. */
type AnalyticsEvent =
  | { name: "verification_start"; params: { input_type: "upload" | "url" } }
  | {
      name: "verification_complete";
      params: { verdict: Verdict; has_source_match: boolean; latency_ms: number };
    }
  | { name: "evidence_expand"; params: { evidence_type: EvidenceType } };

export type Verdict = "real" | "uncertain" | "ai";

/** 펼쳐본 근거의 종류. 화면 문구가 한글이라 그대로 쓰면 문구를 다듬을 때마다
 *  GA 데이터가 끊기므로, 안정적인 영문 슬러그를 따로 둔다. */
export type EvidenceType = "ai_analysis" | "exif" | "c2pa" | "image_metadata" | "similar_search" | "roi_region";

function track({ name, params }: AnalyticsEvent): void {
  // SSR에서는 window가 없고, 개발 빌드에서는 gtag가 없다.
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  try {
    window.gtag("event", name, params);
  } catch {
    // 분석 전송 실패가 사용자 동작을 막아선 안 된다 — 광고 차단기가 gtag를
    // 반쯤 덮어써 둔 경우 등.
  }
}

/** 화면에 보이는 등급과 같은 기준으로 나눈다 — ScoreGauge의 toneForScore가 쓰는
 *  "AI 탐지율 판단 기준"(0-35 낮음 / 36-64 중간 / 65-100 높음)과 동일. 둘이
 *  어긋나면 사용자가 "낮음"을 본 분석이 GA에는 ai로 잡히는 일이 생긴다. */
export function verdictFromProbability(aiProbability: number): Verdict {
  if (aiProbability >= 65) return "ai";
  if (aiProbability >= 36) return "uncertain";
  return "real";
}

export function trackVerificationStart(inputType: "upload" | "url"): void {
  track({ name: "verification_start", params: { input_type: inputType } });
}

export function trackVerificationComplete(params: {
  verdict: Verdict;
  hasSourceMatch: boolean;
  latencyMs: number;
}): void {
  track({
    name: "verification_complete",
    params: {
      verdict: params.verdict,
      has_source_match: params.hasSourceMatch,
      // GA4는 소수점을 그대로 받지만 밀리초 단위 소수는 의미가 없다.
      latency_ms: Math.round(params.latencyMs),
    },
  });
}

export function trackEvidenceExpand(evidenceType: EvidenceType): void {
  track({ name: "evidence_expand", params: { evidence_type: evidenceType } });
}
