/**
 * 비전 제공자 호출에 거는 자체 마감(deadline).
 *
 * 왜 필요한가: 분석 라우트는 Vercel에서 `maxDuration = 60`으로 돈다. 그 예산을
 * 넘기면 Vercel이 함수를 그냥 죽이는데, 그러면 라우트의 try/catch가 실행되지
 * 못해 우리 JSON 대신 플랫폼 에러 페이지(비-JSON)가 나간다. 클라이언트는
 * `detail`을 못 찾아 원인을 알 수 없는 "분석에 실패했습니다."만 띄우게 된다 —
 * 라우트가 직접 낸 오류는 429·413·400·500 전부 `detail`(500은 요청 ID까지)을
 * 담으므로, 그 문구가 보인다는 건 애초에 라우트가 응답하지 못했다는 뜻이다.
 *
 * 그런데 제공자 호출은 함수 예산보다 오래 끌 수 있었다:
 *   - OpenAI: 거절(refusal) 재시도가 최대 3번 순차 실행 × 각 60초 = 최대 180초
 *   - Gemini: 클라이언트에 타임아웃 설정이 아예 없어 무제한
 *   - Claude: 60초 (함수 예산과 동일 — 실패를 응답할 여유가 0)
 *
 * 그래서 함수 예산보다 짧은 마감을 걸어, 늦는 제공자는 포기하더라도 라우트가
 * 항상 제대로 된 JSON을 돌려주게 한다. 포기된 제공자는 "timeout" 결과로 남고
 * 집계는 나머지 제공자 응답으로 정상 진행된다(제공자 하나가 빠지는 것은 이미
 * 파이프라인이 다루는 상황 — API 키 미설정과 같은 경로).
 */

/** 비전 단계에 허용하는 총 시간(ms). 기본 40초 = 라우트의 maxDuration 60초에서
 *  전처리(sharp 디코드/리사이즈), 중복 검사, 저장·기록에 쓸 20초를 남긴 값.
 *  이 둘은 항상 함께 움직여야 한다 — 라우트의 maxDuration을 바꾸면 여기도 그보다
 *  넉넉히 낮게 맞출 것. 실측 기준 제공자 지연은 3~8초 수준이다. */
export function visionBudgetMs(): number {
  const seconds = Number(process.env.VISION_BUDGET_SECONDS || 40);
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : 40) * 1000;
}

/**
 * `work`가 `ms` 안에 끝나지 않으면 거절한다.
 *
 * 던지는 메시지에 "timeout"을 넣는 건 의도적이다 — 각 제공자의 기존 catch가
 * classifyProviderError()로 넘기고, 거기서 이 단어를 보고 category "timeout" +
 * "…응답 시간이 초과되었습니다." 문구로 분류한다. 새 오류 타입을 만들지 않고
 * 기존 분류 경로를 그대로 태우기 위한 것.
 *
 * 진 쪽 Promise는 그대로 계속 돈다(자바스크립트는 Promise를 취소할 수 없다).
 * 이미 나간 API 호출은 과금될 수 있지만, 응답은 마감에 맞춰 나간다.
 */
export async function withDeadline<T>(work: Promise<T>, ms: number, providerLabel: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${providerLabel} call exceeded the ${Math.round(ms / 1000)}s vision timeout`)), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    // 성공했든 마감에 걸렸든 타이머는 반드시 해제 — 안 그러면 이벤트 루프가
    // 최대 ms만큼 더 살아 있어 서버리스 함수가 늦게 종료된다.
    if (timer) clearTimeout(timer);
  }
}
