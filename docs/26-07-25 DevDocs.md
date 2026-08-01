# 26-07-25 DevDocs — 코드리뷰 후속 개선

> `docs/26-07-25 코드리뷰결과보고서.md`에서 나온 항목 중 사용자가 직접 지목한 8개를
> 이번 라운드에서 고쳤습니다. 각 항목마다 "무엇을 왜 어떻게 고쳤는지"와, 진행 중
> 나온 질문에 대한 답을 같이 적습니다. 검증: `npx tsc --noEmit`, `npx eslint`,
> `npm run build` 전부 통과(마지막 섹션 참고).

---

## 1. LLM API 실패가 최종 점수에 영향을 주지 않도록 수정

**변경 파일**: `lib/vision/anthropic.ts`, `lib/vision/gemini.ts`, `lib/vision/openai.ts`

리포트에서 지적한 대로, 세 프로바이더의 모든 에러 분기(`normalizeModelResult(null, ...)` 호출부)에 `isMock: true`를 추가했습니다. `lib/analysis/aggregator.ts:59`의 `visionResults.filter((r) => !r.is_mock)`가 이 플래그 하나만 보고 "합산에 넣을지 말지"를 결정하므로, 이제 API 키 미설정/네트워크 실패/빈 응답/거절 응답 전부 집계에서 제외됩니다.

**결과**: 3개 LLM 중 하나가 실패해도 나머지 LLM들 + (켜져 있다면) DINO만으로 점수가 계산됩니다 — 요청하신 그대로입니다. DINO는 원래부터 이렇게 처리돼 있었어서(`dino.ts:87`), 이번 수정으로 4개 신호 전체가 같은 원칙("실패한 신호는 존재하지 않는 것처럼 취급")으로 통일됐습니다.

참고로 `vision_results` 배열 자체에는 실패한 항목도 여전히 담겨서 응답에 나갑니다(`error_message` 포함) — 그래서 화면에는 "OpenAI: API 연동 실패" 카드가 그대로 뜹니다(`ProviderResultCard.tsx:64-72`). 달라진 건 **그 실패가 종합 점수 계산식에는 더 이상 들어가지 않는다**는 것뿐입니다.

---

## 2. aggregator.ts — 증거 점수에 "부호" 적용

**변경 파일**: `lib/analysis/aggregator.ts`

```ts
const direction = result.is_ai_generated === false ? -1 : result.is_ai_generated === true ? 1 : score >= 0.5 ? 1 : -1;
for (const item of result.evidence) {
  if (item.description) evidenceSummary.push(item.description);
  visualScore += direction * (VISUAL_EVIDENCE_POINTS[item.severity ?? "low"] ?? 1);
}
...
finalScore += Math.max(-25, Math.min(visualScore, 25)); // 이제 ±25 범위
```

각 모델의 `is_ai_generated`(null이면 `score >= 0.5`로 대체 판단)를 보고 그 모델이 제시한 evidence 점수의 부호를 정합니다. "real" 쪽으로 강하게 판정한 모델의 evidence는 이제 finalScore를 실제로 낮춥니다.

### 질문 — severity를 더 세분화(very high/high/medium/low/very low)하면 더 정밀해지지 않나?

**결론부터: 세분화보다 부호가 맞는 방향이라 판단하신 게 정확합니다.** 이유를 조금 더 풀면:

- `severity`가 표현하는 건 **"이 증거가 판정과는 별개로 얼마나 강한 단서인가"**입니다(예: "손가락이 6개다"는 high, "약간 부자연스러운 그림자"는 low). 반면 지금 버그의 원인은 **"그 단서가 어느 방향(AI/real)을 가리키는지 자체가 코드에 아예 없었다"**는 것이었습니다. 즉 버그는 "눈금이 성기다"가 아니라 "부호가 없다"였고, 눈금을 5단계로 늘려도 부호가 없으면 같은 버그가 더 촘촘하게 재발할 뿐입니다.
- 실용적인 이유도 있습니다: `severity`는 LLM이 프롬프트(`prompts.ts`)의 JSON 스키마를 보고 스스로 채우는 값인데, 프롬프트가 이미 `low`/`medium`/`high` 3단계로만 예시를 주고 있습니다(`prompts.ts:78-86` 등). 모델에게 5단계를 요구하면 "high와 very high의 경계"처럼 모델마다, 심지어 같은 모델이라도 요청마다 기준이 흔들리는 값이 하나 더 늘 뿐이고, `normalizeSeverity()`(`normalize.ts:67-70`)가 인식 못 하는 값은 이미 안전하게 "high"로 매핑하도록 되어 있긴 하지만 그만큼 애매한 응답이 늘어날 여지가 커집니다. 지금 3단계는 실제로 신뢰도(confidence)와도 개념이 겹치는 값이라, 여기서 정밀도를 더 짜내려면 `severity`보다는 각 모델이 이미 반환하는 연속값인 `score`(0~1)를 더 적극적으로 쓰는 쪽이 낫습니다.

즉 "판정 방향(부호)"과 "단서의 강도(severity)"는 서로 다른 축이고, 이번엔 방향 축이 통째로 빠져 있던 게 버그였습니다. 방향을 채운 지금 상태에서, 강도 축을 더 세밀하게 할지는 별개 결정으로 남겨두는 게 맞다고 봅니다(당장 급한 문제는 아님).

---

## 3. 요청 바디 크기 — Content-Length 사전 거부

**변경 파일**: `app/api/analyze/image/route.ts`, `app/api/analyze/image-url/route.ts`

두 라우트 모두 `request.formData()`/`request.json()`으로 바디를 실제로 읽기 **전에** `Content-Length` 헤더를 먼저 확인해서, 한도 초과 시 바로 `413`으로 거부하도록 바꿨습니다.

```ts
const declaredLength = Number(request.headers.get("content-length") || 0);
if (declaredLength > maxBytes) {
  ...
  return NextResponse.json({ detail: "이미지 파일이 너무 큽니다." }, { status: 413 });
}
```

`image/route.ts`는 기존 `MAX_FILE_SIZE_MB`(기본 10MB) 한도를 그대로 재사용했고, `image-url/route.ts`는 원래 JSON 바디가 URL 문자열 하나뿐이라 별도로 16KB 상한을 새로 뒀습니다(이 라우트의 DoS 벡터는 "요청 자체의 JSON 바디를 부풀리는 것"이라, 다운로드할 이미지 크기 제한(`maxBytes`, 아래 6번 참고)과는 다른 값입니다).

**한계**: `Content-Length`가 없는 요청(예: `Transfer-Encoding: chunked`)은 이 사전 체크를 그냥 통과합니다 — HTTP 스펙상 클라이언트가 미리 크기를 안 알려주고 보낼 수도 있는 경우라 완전히 막을 수는 없고, 이런 요청은 여전히 기존의 "다 읽은 뒤 체크"(`image/route.ts`의 `arrayBuffer()` 이후 체크)로 넘어갑니다. 즉 이번 수정은 "가장 흔한 케이스(정상적인 HTTP 클라이언트는 거의 다 Content-Length를 보냄)를 조기에 훨씬 싸게 막는 것"이지, 100% 방어는 아닙니다. 완전한 방어는 스트리밍 파서로 바꿔야 하는데, 이번 라운드 범위를 벗어나서 남겨둡니다.

### 질문 — 브라우저 업로드 폼을 쓰면 뭐가 다른가?

두 가지 다른 층위 이야기입니다.

1. **정상적인 사용자가 이 웹서비스의 실제 업로드 폼(`ImageUploader.tsx`)을 쓰는 경우**: `<input type="file">`로 고른 `File` 객체를 `FormData`에 담아 `fetch()`로 보내면(`app/page.tsx:40-44`), 브라우저가 파일 전체 크기를 이미 알고 있으므로 **`Content-Length` 헤더를 자동으로, 정확하게 설정**해서 보냅니다(청크 전송을 안 씀). 그래서 이번에 추가한 사전 체크가 이 정상 경로에서는 항상 정확하게 작동합니다. 다만 지금 `ImageUploader.tsx`에는 클라이언트 쪽 크기 검사가 전혀 없어서(안내 문구 "최대 10MB"만 있고 실제 체크 코드는 없음), 큰 파일을 골라도 서버까지 일단 전송은 시도됩니다 — UX상 아쉬운 부분이라, 원하시면 다음 라운드에 `handleFiles`에서 `file.size > 10MB`면 바로 에러 메시지를 띄우는 걸 추가할 수 있습니다(지금은 요청 범위 밖이라 안 건드렸습니다).
2. **브라우저 UI를 거치지 않고 API를 직접 호출하는 경우** (curl, Postman, 스크립트, 또는 악의적 요청): 브라우저의 자동 `Content-Length` 설정이나 폼의 어떤 제약도 없습니다 — 임의의 크기를 주장하거나(헤더 자체를 조작), 아예 청크 전송으로 크기를 숨긴 채 몇 GB짜리 바디를 보낼 수 있습니다. **이게 원래 리포트에서 지적한 진짜 위협 모델**이고, 그래서 이번 수정은 "브라우저를 믿어서" 안전해진 게 아니라 **서버가 클라이언트 종류와 무관하게 스스로 방어하도록** 만든 것입니다 — Content-Length를 갖고 있는 요청이면 브라우저든 curl이든 똑같이 조기 차단됩니다.

---

## 4. EXIF 회전 — `preprocess.ts` / `pipeline.ts`

**변경 파일**: `lib/image/preprocess.ts`, `lib/analysis/pipeline.ts`

### 질문 — EXIF 회전이 뭐야?

스마트폰 카메라는 사진을 찍을 때 실제로 센서가 읽은 픽셀 배열을 그대로 저장합니다(예: 가로 4032×세로 3024). 사용자가 세로로 들고 찍었어도 마찬가지입니다 — 매번 픽셀을 실제로 회전시켜 저장하면 느리니까, 대신 "이 사진은 90도 돌려서 봐야 함"이라는 **표시(태그)만 EXIF 메타데이터에 남깁니다**(`Orientation` 태그, 1~8 값). 사진 뷰어/브라우저는 이 태그를 읽고 화면에 그릴 때 자동으로 돌려서 보여줍니다 — 그래서 갤러리 앱에서는 항상 똑바로 보이는데, 픽셀 데이터 자체는 가로로 누워 저장돼 있는 경우가 실제로 흔합니다.

문제는: `sharp`로 이미지를 열었을 때 `.metadata().width/height`는 **이 태그를 무시하고 저장된 그대로의(회전 전) 가로/세로**를 돌려준다는 것입니다(sharp 공식 문서에 명시된 동작). 반면 `.rotate()`(인자 없이 호출하면 "EXIF 보고 자동으로 돌려라"라는 뜻)를 파이프라인에 걸어두면 **실제 출력 이미지는 회전됩니다**. 그래서 "회전 전 치수로 계산한 로직"과 "회전 후 이미지에 적용되는 리사이즈"가 서로 다른 좌표계를 쓰게 되는 게 원래 버그였습니다.

### 질문 — `metadata.autoOrient.width/height`가 뭐야?

sharp가 위 문제를 위해 따로 제공하는 필드입니다. `metadata()` 결과 안에 `autoOrient: { width, height }`가 같이 들어있는데, 이건 **EXIF Orientation 태그를 반영한, "실제로 화면에 보이는" 가로/세로**입니다(`node_modules/sharp/lib/index.d.ts:1238-1243`에 타입 정의 있음). 즉 `.rotate()`를 실제로 실행하지 않고도, "회전하면 몇×몇이 될지"를 미리 알 수 있는 값입니다.

**고친 내용**: `preprocess.ts`의 `longestSide` 계산과 `pipeline.ts`가 응답(`AnalysisResult.input.width/height`)에 내보내는 치수 둘 다, `metadata.width/height` 대신 `metadata.autoOrient?.width/height`를 우선 사용하도록 바꿨습니다. 이제 세로로 찍은 스마트폰 사진도 리사이즈가 올바른(회전 후) 긴 변을 기준으로 계산되고, 응답 JSON에 노출되는 가로/세로도 실제 보이는 방향과 일치합니다.

---

## 5. PNG 청크 — 압축된 iTXt 처리

**변경 파일**: `lib/analysis/metadata.ts`

### 질문 — PNG 청크가 뭐야?

PNG 파일은 처음 8바이트 시그니처 뒤로, **"청크(chunk)"라는 블록들이 죽 이어진 구조**입니다. 각 청크는 `[길이(4바이트)][타입 4글자][데이터][CRC 4바이트]` 형식이고, `IHDR`(이미지 크기 등 헤더), `IDAT`(실제 픽셀 데이터, 압축됨), `IEND`(끝) 같은 필수 청크 외에도 **임의의 텍스트를 담을 수 있는 선택적 청크**(`tEXt`, `iTXt`, `zTXt`)가 있습니다. Stable Diffusion WebUI, ComfyUI 같은 AI 이미지 생성 도구들은 관행적으로 이 텍스트 청크에 "어떤 프롬프트/시드/모델로 생성했는지"를 그대로 적어 넣습니다 — 그래서 `metadata.ts`가 이걸 읽어서 AI 생성 여부 판정에 씁니다(`readPngTextChunks()`).

`iTXt`는 그중에서 **UTF-8(국제 문자) + 선택적 압축**을 지원하는 버전입니다. 구조가 `tEXt`보다 복잡해서, 키워드 뒤에 압축 여부를 나타내는 플래그 바이트가 하나 더 있습니다:

```
키워드(가변, null로 끝남) | 압축플래그(1B) | 압축방식(1B) | 언어태그(가변, null로 끝남) | 번역된키워드(가변, null로 끝남) | 실제 텍스트
```

기존 코드는 이 구조를 무시하고 "키워드 뒤 null부터 끝까지"를 통째로 UTF-8로 디코딩했는데, 압축플래그가 1(zlib 압축)인 경우 그 구간은 사람이 읽을 수 있는 텍스트가 아니라 **압축된 바이너리**라서 디코딩 결과가 깨진 문자열이 됩니다.

**고친 내용**: 압축플래그·압축방식·언어태그·번역된키워드를 순서대로 건너뛴 뒤, 압축플래그가 1이면 Node 내장 `zlib.inflateSync()`로 압축을 풀고, 0이면 기존처럼 바로 디코딩합니다. 압축 해제에 실패하면(손상된 데이터 등) 조용히 스킵합니다.

```ts
if (compressionFlag === 1) {
  try { text = inflateSync(textBytes).toString("utf-8"); }
  catch { text = ""; }
} else {
  text = textBytes.toString("utf-8").replace(/\0/g, "");
}
```

이제 압축된 `workflow`/`parameters` 필드로 생성 도구 흔적을 남기는 이미지도 놓치지 않고 잡습니다.

---

## 6. `safeFetch.ts` — 본문 다운로드 구간에도 타임아웃 적용

**변경 파일**: `lib/net/safeFetch.ts`

기존엔 `AbortController` 타이머가 `fetch()`가 헤더를 받아온 순간(`finally`) 바로 해제돼서, 그 이후 `reader.read()`로 실제 바이트를 받는 스트리밍 루프는 시간 제한이 전혀 없었습니다. 이제 타이머 해제(`clearTimeout`)를 헤더 수신 직후가 아니라 **한 홉(hop)의 처리가 완전히 끝난 뒤**(리다이렉트로 다음 홉으로 넘어가거나, 다운로드가 끝나거나, 에러가 나거나)로 옮겼습니다. 같은 `AbortController`의 `signal`이 `fetch()` 호출 전체(바디 스트리밍 포함)에 걸쳐 살아있으므로, 타임아웃이 지나면 `reader.read()`도 `AbortError`로 실패하고 이걸 잡아서 기존과 같은 "다운로드 시간 초과" 메시지로 변환합니다.

**결과**: 헤더는 즉시 응답하고 바이트를 아주 느리게(예: 초당 몇 바이트) 흘리는 서버를 만나도, `maxBytes` 크기 제한과 별개로 `timeoutMs`(기본 60초, `REQUEST_TIMEOUT_SECONDS`) 안에 반드시 끝나거나 실패합니다.

### 질문 — `maxBytes`는 어떻게 설정돼 있나?

호출부(`app/api/analyze/image-url/route.ts:29,33`)에서 만들어서 `safeFetchImage()`에 인자로 넘겨줍니다:

```ts
const maxBytes = Number(process.env.MAX_FILE_SIZE_MB || 10) * 1024 * 1024;
```

즉 파일 업로드 라우트(`image/route.ts`)와 **같은 환경변수(`MAX_FILE_SIZE_MB`, 기본 10MB)를 공유**합니다 — "파일 업로드든 URL 다운로드든, 분석 대상 이미지의 최대 크기는 하나의 설정값으로 통일"이라는 의도입니다. `safeFetchImage` 내부에서는 이 값을 두 군데서 씁니다: ① 응답의 `Content-Length` 헤더가 이미 이 값을 넘으면 바로 거부(다운로드 시작 전), ② 헤더가 없거나 거짓말인 경우를 대비해 실제로 받은 누적 바이트(`total`)가 이 값을 넘는 순간 스트림을 취소(`reader.cancel()`)하고 거부 — 둘 다 있어야 서버가 크기를 속이는 경우까지 막습니다.

---

## 7. 에러 메시지 — 원문은 서버 콘솔/로그에만, 클라이언트에는 일반 메시지만

**변경 파일**: `app/api/analyze/image/route.ts`, `app/api/analyze/image-url/route.ts`

`ImageValidationError`(이미지 자체 문제)와 `SecurityViolationError`(차단된 URL 등, `image-url` 라우트에만 해당)는 원래도 사용자가 뭘 고쳐야 할지 알려주기 위한 **의도된 사용자용 메시지**라 그대로 두었습니다(400 응답). 반면 그 외 모든 예외(500)는:

- `console.error(...)`로 서버 콘솔에 원문 출력
- `logAnalysisEvent(...)`로 기존처럼 로컬 `storage/logs/*.jsonl` + Supabase `request_logs`에 원문 그대로 기록(운영 중 진단용, 이건 원래도 하고 있었음)
- 클라이언트 응답은 **항상 일반화된 문구 + 요청 ID**만:

```
이미지 분석 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요. (요청 ID: req_20260725_...)
```

요청 ID를 남긴 이유는, 사용자가 문의할 때("이 요청 ID로 실패했어요") 운영자가 로그에서 원문 에러를 바로 찾아볼 수 있게 하기 위해서입니다 — 정보는 숨기되 추적 가능성은 잃지 않는 절충입니다.

---

## 8. 프리뷰 이미지 — 항상 "실제로 분석한" 바이트를 보여줌

**변경 파일**: `types/analysis.ts`, `lib/analysis/pipeline.ts`, `app/page.tsx`

`AnalysisResult`에 `analyzed_image_data_url` 필드를 추가했습니다 — `lib/image/preprocess.ts`가 만드는, **모델들에게 실제로 전달된 정규화된 JPEG**(EXIF 회전 반영 + 흰 배경 flatten + 긴 변 리사이즈 + JPEG 재인코딩 완료된 바이트)를 data URL로 그대로 담아 응답에 실어 보냅니다(`pipeline.ts:110`).

`app/page.tsx`는 분석 결과를 받는 즉시 `setPreviewUrl(result.analyzed_image_data_url)`로 프리뷰 상태를 이걸로 덮어씁니다 — 파일 업로드 모드든 URL 모드든 동일하게 적용됩니다. 그 결과:

- **URL 모드**: 기존엔 사용자가 입력한 원본 URL을 브라우저가 독립적으로 다시 요청해서 보여줬는데(서버가 리다이렉트를 따라가 받은 이미지와 다를 수 있었음), 이제는 서버가 실제로 다운로드·분석한 바로 그 바이트를 보여줍니다.
- **파일 업로드 모드**: 기존엔 사용자가 고른 원본 파일 그대로를 보여줬는데, 이제는 분석 과정에서 (예: 매우 큰 이미지를 리사이즈했거나, PNG를 흰 배경으로 flatten했거나) 실제로 변형된 형태를 보여줍니다 — "이미지를 어떻게 변형하여 분석했는지 궁금할 것"이라는 말씀 그대로, 판정 근거가 된 바운딩 박스가 그려지는 이미지 자체가 이제 항상 그 판정의 입력과 정확히 일치합니다.

**트레이드오프**: 매 분석 응답에 base64 인코딩된 JPEG가 통째로 실리므로 응답 크기가 늘어납니다(대략 긴 변 1024px, quality 92 기준 최종 응답에 수백 KB 추가). 지금 트래픽 규모에서는 문제 될 정도는 아니라고 보고 이 방식을 택했습니다 — 나중에 트래픽이 늘면 (Supabase Storage에 이미 저장되고 있는 이미지의) signed URL을 대신 내려주는 방식으로 바꿀 수 있습니다(`lib/storage/imageStore.ts`에 이미 있는 primary(Supabase)/fallback(로컬) 저장 로직 위에 얹으면 됨) — 지금 당장 필요한 변경은 아니라 이번 라운드엔 포함하지 않았습니다.

---

## 9. `extensions/` 폴더 스캐폴딩

`extensions/README.md`만 추가했습니다 — 코드는 아직 없습니다(요청하신 대로 개발은 착수 안 함). 별도 repo 대신 이 폴더로 관리하기로 한 이유와, 나중에 분리를 고려할 시점을 문서화해뒀습니다(코드리뷰 리포트의 답변과 동일한 내용).

---

## 검증

```
npx tsc --noEmit -p tsconfig.json    # 통과, 에러 0건
npx eslint <변경된 파일 전체>          # 통과, 경고/에러 0건
npm run build                         # 통과 (Next.js 16.2.10 / Turbopack)
```

빌드 로그에 `Couldn't load fs` / `Couldn't load zlib` 경고가 뜨는데, 이건 이번 변경과 무관한 **기존에 알려진 경고**입니다(`next.config.ts:8`, `docs/HANDOFF_2026-07-25.md` 참고 — Supabase가 끌고 오는 `ws` 라이브러리가 내는 무해한 소음이라고 이미 문서화돼 있음). 확인 차 metadata.ts에 새로 추가한 `node:zlib` import가 원인이 아닌지 짚어봤는데, 이 경고는 그 이전부터 있던 것이라 무관합니다.

실제 API 호출 기반 통합 테스트(브라우저에서 업로드/URL 분석 흘려보기)는 이번 세션에서는 수행하지 못했습니다 — `npm run dev`를 띄우고 실제 이미지로 한 번 확인해보시는 걸 권장드립니다. 특히 8번(프리뷰 이미지 교체)과 4번(세로 사진 리사이즈)은 실제 스마트폰 세로 사진으로 눈으로 확인하시는 게 가장 확실합니다.

---

# 라운드 2 (같은 날 후속)

> 1라운드 이후 추가로 요청하신 항목들. 이번 라운드는 실제로 두 서버(`npm run dev`,
> `python ml/serve.py`)를 띄우고 진짜 API 키로 실제 이미지를 흘려보내는 **실제 실행
> 검증까지 포함**했습니다 — 아래 11번 참고.

## ⚠️ 지금 바로 하셔야 하는 것 — Supabase SQL Editor에서 `supabase/schema.sql` 재실행

pgvector 연동(16번 참고)을 위해 `insert_image_record`/`find_similar_by_embedding` 함수와
`images_embedding_hnsw_idx` 인덱스를 `supabase/schema.sql`에 추가했는데, **이 파일은
제가 직접 실행할 방법이 없습니다**(Supabase 대시보드 접속 수단 없음 — `request_logs`
테이블 추가 때와 같은 제약, `docs/DINO_AND_STORAGE_INTEGRATION.md` Part 3.3 참고).
실제로 서버를 띄워 테스트해보니 아래처럼 **콘솔에 에러가 찍히는 것까지 직접
확인했습니다**:

```
[imageRecords] insert_image_record failed {
  code: 'PGRST202',
  message: 'Could not find the function public.insert_image_record(..., p_embedding, ...) in the schema cache'
}
```

**해야 할 일**: Supabase 대시보드 → SQL Editor에서 `supabase/schema.sql` 전체를 다시
붙여넣고 Run. `create or replace function`/`create table if not exists`/
`create index if not exists`라서 기존 데이터·`request_logs` 테이블은 전혀 건드리지
않고, 새로 추가된 부분만 반영됩니다.

**이걸 안 하면 지금 어떻게 되나**: best-effort 패턴이 정확히 설계대로 동작해서,
분석 자체는 계속 200으로 정상 응답합니다 — 다만 pgvector 저장/kNN 검색이 조용히
전부 스킵됩니다(콘솔에 에러만 찍힘). 즉 서비스가 죽거나 사용자에게 에러가 노출되는
일은 없지만, **이번에 만든 pgvector 기능 자체는 SQL을 실행하기 전까지 아무 효과가
없습니다.**

---

## 10. LLM API 실패 원인을 구조화해서 로깅

**질문**: 실패가 네트워크 오류인지 컨텐츠 정책 위반인지 알 수 있나? 로깅되고 있나?

**답변**: 원래도 `lib/vision/errorMessage.ts`(`describeProviderError`)가 각 실패를
분류해서 한국어 메시지를 만들고는 있었는데(예: "API 키가 유효하지 않거나...", "사용량
한도(rate limit)에 도달..."), **그 분류 자체(카테고리)는 메시지 문자열 안에만
녹아있고 별도 필드로 저장되진 않았습니다** — 로그에서 "이 실패가 rate_limit이었나
auth였나"를 정확히 뽑아내려면 한국어 문장을 정규식으로 다시 파싱해야 했다는 뜻입니다.
OpenAI의 컨텐츠 정책 거절도 마찬가지로 `openai.ts`에 커스텀 메시지만 있었고 별도
분류값은 없었습니다.

**변경 파일**: `lib/vision/errorMessage.ts`, `lib/vision/normalize.ts`,
`lib/vision/{anthropic,gemini,openai}.ts`, `lib/analysis/dino.ts`,
`types/analysis.ts`, `lib/logging/analysisLogger.ts`

`describeProviderError(error, label): string` 대신 `classifyProviderError(error,
label): { category, message }`를 새로 만들고, `VisionResult`에 `error_category`
필드를 추가했습니다. 분류 값:

```ts
type ProviderErrorCategory =
  | "missing_api_key"   // .env.local에 키가 아예 없음
  | "timeout"            // 응답 시간 초과
  | "auth"               // 401/403 — 키가 유효하지 않거나 권한 없음
  | "rate_limit"         // 429
  | "server_error"       // 5xx
  | "network"            // ECONNREFUSED/ENOTFOUND 등
  | "content_policy"     // OpenAI 콘텐츠 정책 거절 (openai.ts 전용)
  | "empty_response"     // 200인데 텍스트가 비어있음
  | "parse_failure"      // 200인데 JSON 파싱 실패
  | "unknown";
```

이제 API 응답(`vision_results[i].error_category`)과 Supabase `request_logs` 양쪽에
이 값이 그대로 남습니다 — `analysisLogger.ts`가 이미 provider별 정보를 `providers`
jsonb 컬럼에 넣고 있어서(스키마 변경 불필요), 예를 들어 아래처럼 필터링할 수 있습니다:

```sql
-- 최근 rate limit에 걸린 요청만 보기
select request_id, created_at, providers
from request_logs
where providers @> '[{"error_category":"rate_limit"}]'
order by created_at desc;
```

즉 지금부터는 "오늘 OpenAI가 몇 번 콘텐츠 정책으로 거절했는지", "Gemini rate
limit이 몇 번 걸렸는지"를 로그 텍스트를 눈으로 훑지 않고 SQL 한 줄로 셀 수
있습니다.

---

## 11. 이미지 분석 파이프라인 흐름 검증 — 실제로 서버를 띄워서 확인함

**질문**: 이미지를 넣으면 리사이징 → phash 비교 → ... 흐름이 정말 맞게 동작하는지.

코드만 읽고 "맞을 겁니다"라고 답하는 대신, 실제로 `python ml/serve.py`(GPU 사용
가능 확인함, `torch.cuda.is_available()=True`) + `npm run dev`를 띄우고 진짜 API
키로 여러 시나리오를 흘려봤습니다. 확인된 흐름은 이렇습니다:

```
1. sharp로 원본 메타데이터 읽기 (EXIF 회전 반영 치수 계산)
2. preprocessImage() — EXIF 자동회전 → 흰 배경 flatten → 긴 변 리사이즈 → JPEG 재인코딩
3. generatePHash() — 전처리된 이미지로 64bit pHash 계산
4. findSimilarImages(phash) 시작 (아래 3번 결과가 나올 때까지 기다리지 않고 병렬 진행)
5. analyzeMetadata() — EXIF/PNG 청크 읽고 AI 도구 키워드 매칭
6. decideRouting() — quick 모드 + 강한 메타데이터 증거면 LLM 호출 스킵
7. 3개 LLM + DINO를 Promise.all로 동시 호출 (DINO는 embedding도 같이 받음)
8. aggregateAnalysis() — 메타데이터 점수 + 방향(부호) 적용된 vision 점수 합산
9. saveAnalyzedImage() — Supabase Storage에 전처리된 이미지 저장
10. phash 매치 없으면 findSimilarByEmbedding()으로 2단계 폴백
11. insertImageRecord() — phash+embedding을 Supabase images 테이블에 기록
12. logAnalysisEvent() — Supabase request_logs에 기록
```

**실제 테스트 결과** (`test-data/images/`의 기존 합성 테스트셋 활용):

| 시나리오 | 파일 | 결과 |
|---|---|---|
| 표준 전체 흐름 | `large-photo.jpg`, mode=standard | HTTP 200, 8.8초. `vision_results`에 openai/gemini/claude/dino 4개 전부 응답(점수 0~0.69), `final_result.ai_probability=5`(실제 이미지로 정확히 판정 — DINO 혼자 "AI일 수도"라고 했지만 3개 LLM이 강하게 "real"이라 해서 **2번에서 고친 부호 로직이 실제로 다수결을 정확히 반영함을 확인**), `analyzed_image_data_url` 정상 포함, `duplicate_check.checked=true` |
| 대용량 파일 거부 | `oversized.jpg`(11MB) | HTTP **413**, **0.29초** — 바디를 버퍼링하지 않고 Content-Length만 보고 즉시 거부(3번 항목이 실제로 빠르게 작동함을 확인) |
| 손상된 이미지 | `corrupt.jpg` | HTTP 400, "이미지를 읽을 수 없습니다..." — `ImageValidationError` 경로 정상 |
| PNG 메타데이터로 LLM 스킵 | `fake-ai-metadata.png`, mode=quick | HTTP 200, `vision_results.length=1`(DINO만 — 3개 LLM은 호출 자체가 스킵됨, 비용 절감 확인), `metadata_analysis.ai_tool_detected=true`, `detected_tools=["Stable Diffusion"]`, PNG `parameters`/`prompt` 필드 정확히 파싱됨, `final_result.ai_probability=62`("AI 생성 의심") |
| Supabase 로깅 | 위 4건 전부 | `request_logs` 테이블에 4개 행이 실제로 들어간 것을 `supabase-js`로 직접 쿼리해서 확인 — **로컬 파일엔 아무것도 안 씀(18번 항목)이 실제로 동작함** |
| pgvector 저장 | 위 4건 전부 | 위 "지금 바로 하셔야 하는 것" 참고 — SQL 미실행 상태라 `images` 테이블 insert는 실패하고 콘솔에 에러만 찍힘(분석 자체는 정상 200). **best-effort 패턴이 설계대로 동작하는 것도 같이 확인한 셈**입니다. |

테스트에 쓴 두 서버는 확인 후 종료해뒀습니다.

---

## 12. AI 생성 / 위변조 / 실제 이미지 데이터셋 조사

**중요한 구분부터**: 지금 `ml/` 파이프라인(DINOv3 임베딩 + linear probe)은
**"이 이미지 전체가 AI로 생성됐는가"를 이진 분류**하도록 설계돼 있습니다. 반면
"위변조(tampering)"는 보통 **"실제 사진의 일부를 스플라이싱/카피무브/오브젝트
제거로 조작했는가, 조작됐다면 어느 픽셀 영역인가"**를 다루는 다른 종류의
문제라서, 픽셀 단위 마스크 라벨과 다른 모델 구조(예: ManTraNet, CAT-Net류의
localization 모델)가 필요합니다. 즉 아래 위변조 데이터셋들은 지금 파이프라인에
그대로 꽂히지 않고, "위변조 탐지"를 실제 기능으로 넣으려면 별도 모델/라벨링
전략이 필요하다는 점을 먼저 짚어둡니다(구현은 안 했습니다 — 조사만).

### 실제 이미지(real)
- 이미 사용 중: **Unsplash Lite Dataset** — 상업적 ML 학습 명시적 허용, 계속 이걸로 확장하면 됩니다.

### AI 생성 이미지(ai_generated) — 생성기 다양화용
- 이미 사용 중: **DiffusionDB**(Stable Diffusion, CC0)
- **FLUX.1-schnell** — 라이선스 재확인 결과 **Apache 2.0, 상업적 사용 명시적으로
  허용**(리비전 없음, 기존 계획대로 진행해도 안전). FLUX.1-dev/FLUX.2 등 다른
  변형은 비상업 라이선스인 경우가 있으니 반드시 "schnell"만 쓰세요.
- **GenImage**(Huawei 공개, Midjourney/SD/ADM/GLIDE/Wukong/VQDM/BigGAN 등 7종
  생성기 혼합, 약 130만 장) — 규모와 생성기 다양성은 매력적이지만, **정확한 라이선스
  텍스트를 이번 조사에서 직접 확인하지 못했습니다**(리포지토리에 LICENSE 파일이
  있다는 언급만 있고 내용을 못 가져왔음). 예전에 GenImage/JourneyDB를 "라이선스
  불명확"으로 이미 한 번 제외했던 결정(`docs/DEV_PROGRESS_MODULE_AB.md`)이 아직
  유효한지, 실제 저장소의 LICENSE 파일을 직접 열어서 재확인해보시는 걸 권합니다 —
  https://github.com/GenImage-Dataset/GenImage
- 팀 보유 도구(Midjourney 등) — 기존 계획대로 수동 생성. 다만 Midjourney 자체
  이용약관에 "생성된 이미지를 경쟁 AI 모델 학습에 쓰는 것"에 대한 조항이 있을 수
  있어(판별기/분류기 학습이 이 조항의 "경쟁 모델"에 해당하는지는 애매한 영역),
  대량으로 쓰기 전에 최신 Midjourney ToS를 한 번 더 확인해보시는 걸 권합니다.

### 위변조/조작 이미지(tampered) — 지금 파이프라인엔 없는 완전히 새 카테고리
스플라이싱/카피무브/오브젝트 제거 데이터셋들(전부 픽셀 단위 마스크 포함):

| 데이터셋 | 규모 | 유형 | 비고 |
|---|---|---|---|
| CASIA v2.0 | 학습 7,491 / 테스트 5,123 | 스플라이싱, 카피무브 | 가장 널리 쓰이는 벤치마크 |
| IMD2020 | 학습/테스트 각 35,000 | 스플라이싱, 카피무브, 제거 | 실제 인터넷 수집 이미지 기반, 대규모 |
| DEFACTO | 22만 장 이상 | 스플라이싱, 카피무브, 제거 | MS-COCO 기반 자동 생성 |
| PS-Battles | 학습 11,142 / 테스트 102,028 | 다양(포토샵 배틀 커뮤니티 소스) | |
| CoMoFoD | 10,400여 장 | 카피무브 전용 | 소규모 |

⚠️ **라이선스 확인 필요**: 이 5개 전부 이번 조사에서 **명시적인 라이선스 조항을
확인하지 못했습니다**(공개 리포지토리 문서에 언급이 없음). 학술 포렌식
데이터셋들은 관행적으로 "연구 목적"으로만 배포되고 상업적 이용 전엔 별도
동의/신청 절차가 필요한 경우가 흔합니다(CASIA는 실제로 다운로드 페이지에서
신청 절차를 거칩니다) — Unsplash 때 겪었던 것과 같은 함정이 있을 수 있으니,
실제로 다운로드하기 전에 **각 데이터셋의 공식 다운로드 페이지에서 라이선스
조항을 직접 확인하는 절차를 반드시 거쳐주세요**. 이 부분은 제가 확정적으로
"안전하다"고 보증할 근거가 부족해서 일부러 결론을 안 내렸습니다.

---

## 13. 클라이언트 파일 크기 사전 검사 (`ImageUploader.tsx`)

**변경 파일**: `components/upload/ImageUploader.tsx`, `app/page.tsx`

`handleFiles()`에서 파일을 고른 즉시(드래그 앤 드롭 포함) `file.size`를
`MAX_FILE_SIZE_MB`(10MB, 서버와 같은 기본값)와 비교해서, 초과하면 업로드 시도
자체를 안 하고 바로 에러 메시지를 띄우도록 했습니다. `ImageUploader`에
`onError` prop을 새로 추가해서 `app/page.tsx`의 기존 `errorMessage` 상태에
연결했습니다.

```ts
if (file.size > maxBytes) {
  onError(`이미지 파일이 너무 큽니다 (${...}MB > ${MAX_FILE_SIZE_MB}MB). 더 작은 파일을 선택해주세요.`);
  return;
}
```

3번 항목에서 설명한 대로 이건 **UX 편의일 뿐 보안 경계가 아닙니다** — 서버는
클라이언트가 뭘 보내든 자기 몫의 검사(Content-Length 사전 거부)를 그대로
합니다. 이 체크는 "정상적인 사용자가 큰 파일을 골랐을 때 업로드가 끝날 때까지
기다렸다가 실패 메시지를 보는" 나쁜 경험을 없애는 용도입니다.

---

## 14. sharp가 뭐야?

**`sharp`**는 이 프로젝트가 이미지 처리에 쓰는 Node.js 라이브러리입니다
(`package.json`에 `"sharp": "^0.35.3"`). 내부적으로는 **libvips**라는 C
라이브러리를 감싸고 있는데, libvips는 ImageMagick 같은 다른 이미지 라이브러리보다
**메모리를 훨씬 적게 쓰면서 빠르게** 동작하도록 설계된 라이브러리입니다(이미지
전체를 메모리에 다 올리지 않고 스트리밍/타일 단위로 처리).

이 프로젝트에서 sharp가 하는 일들 (전부 실제 코드 위치):
- **리사이즈/회전/포맷 변환**: `lib/image/preprocess.ts` — 원본 이미지를 EXIF
  회전 반영 + 흰 배경 flatten + 긴 변 리사이즈 + JPEG 재인코딩까지 한 번에.
- **메타데이터 읽기**: `lib/analysis/pipeline.ts`에서 `sharp(...).metadata()`로
  가로/세로/포맷/EXIF Orientation 태그 등을 읽음.
- **pHash 계산용 전처리**: `lib/analysis/phash.ts` — 흑백 변환 + 32×32
  리사이즈까지 sharp가 하고, 그 이후 DCT 계산은 직접 구현.
- **이미지 종류 판별**: `lib/vision/prompts.ts`의 `detectImageType()` —
  픽셀아트/일러스트/사진을 색상 수 분석으로 구분할 때 100×100으로 축소하는 데 사용.

한 줄로: **"이미지를 열고, 자르고, 돌리고, 리사이즈하고, 포맷을 바꾸는" 모든
작업을 이 프로젝트에서 담당하는 라이브러리**입니다. Node.js 생태계에서 이미지
처리 라이브러리로는 사실상 표준으로 쓰입니다.

---

## 15. PNG 청크를 실제로 확인하는 방법

5번(코드리뷰 개선)에서 PNG 청크 구조 자체는 설명했으니, 여기서는 **직접 눈으로
확인하는 방법**을 드립니다. 새로 스크립트를 하나 추가했습니다:

```bash
node scripts/inspect-png-chunks.js path/to/image.png
# 또는
npm run inspect:png -- path/to/image.png
```

`lib/analysis/metadata.ts`의 `readPngTextChunks()`와 같은 파싱 로직(iTXt 압축
해제 포함)을 독립 실행해서, 파일에 어떤 청크가 몇 바이트씩 들어있는지, tEXt/iTXt는
실제로 어떤 키/값을 담고 있는지를 그대로 출력합니다. 실제로 기존 테스트 픽스처로
돌려본 결과:

```
$ node scripts/inspect-png-chunks.js test-data/images/fake-ai-metadata.png
test-data/images/fake-ai-metadata.png (4650 bytes)

  [0] IHDR (13 bytes) — 512x512, bit depth 8, color type 2
  [1] pHYs (9 bytes)
  [2] IDAT (4423 bytes)
  [3] tEXt (102 bytes) — parameters = "a photo of a cat, Steps: 20, Sampler: Euler a, CFG scale: 7, Seed: 12345, Model: sd_xl_base"
  [4] tEXt (23 bytes) — prompt = "a photo of a cat"
  [5] IEND (0 bytes)
```

**부수 발견**: 스크립트를 만들면서 PNG의 세 번째 텍스트 청크 타입인 **`zTXt`(압축된
`tEXt`, 언어 태그 없음)**를 이 프로젝트가 아예 파싱하지 않는다는 걸 확인했습니다
(`metadata.ts`는 `tEXt`/`iTXt`만 처리). 실무에서 AI 생성 도구들이 압축 텍스트
청크를 쓸 땐 거의 항상 `iTXt`(5번에서 고친 것)를 쓰고 `zTXt`는 잘 안 쓰여서 지금
당장 급한 문제는 아니라고 판단해 `metadata.ts`는 안 건드렸지만, 참고차 남겨둡니다
— 새 스크립트는 `zTXt`가 있으면 디코딩하면서 "metadata.ts는 이걸 안 읽습니다"라고
경고를 같이 찍어줍니다.

다른 방법(참고용): PNG 청크는 표준 포맷이라 `exiftool -PNG:all image.png`(별도
설치 필요) 같은 범용 도구로도 볼 수 있습니다 — 이번엔 프로젝트 코드와 100% 같은
파싱 로직을 보고 싶어서 전용 스크립트를 만들었습니다.

---

## 16. pgvector 연동 — 상세

리포트에서 "아직 완전 미사용"이라고 답했던 그 기능을 실제로 연결했습니다. 전체
경로를 순서대로 설명합니다.

### 16.1 왜 이렇게 설계했나 — "2단계 폴백"

목표는 사용자가 원래 설명하신 그대로입니다: **pHash로 빠르게 완전/근접 중복을
잡고(재압축·리사이즈 수준), pHash로 안 잡히면 그제서야 DINOv3 임베딩으로 "의미적으로
비슷한" 이미지를 찾아서 판정에 참고 정보로 붙인다.** pHash 검색은 항상 먼저
시도되고(더 싸고, 더 정확한 "동일 이미지" 판정), 임베딩 kNN 검색은 pHash가
비어있을 때만 추가로 한 번 더 나갑니다 — 매 요청마다 두 검색을 항상 다 하지
않는 이유는 pHash 매치가 있으면 임베딩 검색이 알려줄 정보가 없기 때문입니다
(이미 "동일 이미지"라는 더 강한 결론이 나와 있으니까).

### 16.2 `ml/serve.py` — 임베딩을 응답에 포함

`embed_image()`는 원래도 384차원 벡터를 계산하고 있었는데(분류에만 쓰고
버렸음), `/infer` 응답에 그대로 실어 보내도록 한 줄 추가했습니다:

```python
self._respond(200, {"ai_probability": round(proba_ai, 4), "embedding": emb.tolist()})
```

추가 추론 없이 이미 계산된 배열을 JSON으로 직렬화만 하는 거라 비용은 거의 0입니다.

### 16.3 `lib/analysis/dino.ts` — `VisionResult`와 embedding을 분리해서 반환

여기가 설계상 제일 중요한 결정이었습니다. `VisionResult`는 API 응답과 로그에
그대로 나가는 타입인데, 여기에 384개짜리 float 배열을 얹으면 응답/로그가
불필요하게 커지고 원래 목적(판정 결과 표현)과도 안 맞습니다. 그래서
`analyzeWithDino()`의 반환 타입을 바꿨습니다:

```ts
export interface DinoOutcome {
  result: VisionResult;        // 기존처럼 aggregator/응답/로그로 흘러감
  embedding: number[] | null;  // pipeline.ts만 사용, 응답엔 안 나감
}
```

DINO 서버 호출 실패 시(`embedding: null`)도 명확히 구분되고, `pipeline.ts`가
"임베딩이 있을 때만 폴백 검색을 시도"하도록 자연스럽게 이어집니다.

### 16.4 `supabase/schema.sql` — RPC 확장 + HNSW 인덱스

- `insert_image_record`에 `p_embedding vector(384) default null` 추가(기존
  호출부와 호환되도록 기본값 null).
- `images_embedding_hnsw_idx` — pgvector의 근사 최근접 이웃(ANN) 인덱스. NULL
  임베딩(= DINO 꺼져있던 시절 기록)은 자동으로 인덱스에서 빠집니다.
- `find_similar_by_embedding(p_embedding, p_max_distance=0.15, p_limit=20)` —
  코사인 거리(`<=>`, 0=완전 동일 방향~2=정반대) 기반 kNN. `find_similar_images`
  (pHash)와 나란히 두되 별도 함수로 분리 — 두 검색은 임계값의 의미 자체가
  완전히 다르기 때문입니다(비트 개수 차이 vs 코사인 거리).

**임계값 0.15는 추측값입니다** — 실 데이터가 쌓이기 전엔 "이 정도면 의미적으로
비슷하다"의 정확한 기준을 알 방법이 없어서, 리포트에 이미 있던 "pHash 임계값
실데이터 재보정 미착수" 항목과 같은 종류의 작업으로 남겨뒀습니다. 보수적으로
(가까운 것만) 시작했으니, 나중에 실제 매치/오탐 사례를 보고 조정하시면 됩니다.

### 16.5 `lib/db/imageRecords.ts` — 새 함수 2개

```ts
findSimilarByEmbedding(embedding, options)  // find_similar_by_embedding RPC 래퍼
insertImageRecord({ ..., embedding })       // 기존 함수에 embedding 파라미터 추가
```

`SimilarImageMatch`에 `match_type: "phash" | "embedding"`을 추가해서, 클라이언트가
"이게 완전/근접 중복인지, 그냥 의미적으로 비슷한 이미지인지"를 구분할 수 있게
했습니다(`types/analysis.ts`도 동일하게 업데이트).

### 16.6 `lib/analysis/pipeline.ts` — 배선

```ts
const phashMatchesPromise = findSimilarImages(phash);              // 항상 먼저 시작
...
const dinoPromise = dinoEnabled ? analyzeWithDino(preprocessed.buffer) : Promise.resolve(null);
const [llmResults, dinoOutcome] = await Promise.all([Promise.all(llmCalls), dinoPromise]);
const dinoEmbedding = dinoOutcome?.embedding ?? null;
...
const phashMatches = await phashMatchesPromise;
const similarMatches = phashMatches.length > 0 || !dinoEmbedding
  ? phashMatches
  : await findSimilarByEmbedding(dinoEmbedding);   // 2단계: pHash가 비었을 때만
...
await insertImageRecord({ ..., embedding: dinoEmbedding });
```

DINO 호출을 LLM 3개와 별도 변수(`dinoPromise`)로 뒀지만, `Promise.all`로 여전히
동시에 실행됩니다 — 응답 시간에 영향 없습니다.

### 16.7 아직 하지 않은 것 — "유사 이미지 판정을 점수에 반영"

원래 말씀하신 것 중 **"유사한 이미지가 AI라고 판단됐다면 이것도 AI일 가능성을
높인다"** 부분은 **이번 라운드에 포함하지 않았습니다**. 지금까지 한 건 저장 +
검색(retrieval) 인프라이고, 그 결과를 `aggregator.ts`의 점수 계산에 실제로
반영하는 건 별도의 설계 결정이 필요하다고 판단했습니다 — 예를 들어 유사 이미지가
1개면 몇 점을 줄지, 상반된 판정의 유사 이미지가 여러 개 섞이면 어떻게 할지, 무엇보다
**한 번 잘못 판정된 이미지가 향후 비슷한 이미지들의 판정까지 계속 오염시키는
피드백 루프**를 어떻게 막을지 등을 신중하게 정해야 합니다. 지금은
`duplicate_check.matches`에 `match_type: "embedding"`인 항목이 응답에 그대로
노출되니, 원하시면 프론트엔드에서 참고 정보로 보여주는 것부터 시작할 수 있고,
점수 반영은 다음 라운드에 설계를 논의하고 진행하는 걸 권합니다.

---

## 17. `filename`이 "플러밍(plumbing)된다"는 게 뭐임?

리포트 원문(finding #6)의 표현을 그대로 썼는데, 설명이 부족했습니다. **"플러밍
(plumbing)"**은 "배관 공사"라는 뜻으로, 소프트웨어에서는 **어떤 값을 실제로
쓰지도 않으면서 함수 시그니처와 호출부를 계속 통과시키기만 하는 것**을 가리킬 때
쓰는 흔한 표현입니다(파이프만 연결해놓고 물은 안 흐르게 해놓은 상태에 비유).

구체적으로 `lib/analysis/metadata.ts:79`의 `analyzeMetadata(imageBuffer, options)`
함수는 `options.filename`을 파라미터로 **받기는 하는데**, 함수 본문 어디에서도
`filename`을 실제로 읽지 않습니다. 반면 같은 함수가 `options.sourceUrl`은
실제로 씁니다(`metadata.ts:186-192` — URL 문자열에 `AI_SOFTWARE_KEYWORDS`가
포함되는지 검사). 즉:

- `app/api/analyze/image/route.ts` → `pipeline.ts` → `metadata.ts`까지
  `filename`("배관")은 끝까지 이어져 있는데
- 정작 마지막 지점에서 그 값으로 뭔가를 계산하는 코드("물")가 없다

는 뜻입니다. 예를 들어 사용자가 `stable-diffusion-output-seed12345.png` 같은
파일명을 업로드해도, 지금 코드는 URL 키워드 검사와 똑같은 로직을 파일명에는
적용하지 않아서 이 신호를 놓칩니다. 버그라기보단 "구현하다 만 기능"에 가깝고,
이번 라운드에선 명시적으로 요청하신 항목이 아니라 손대지 않았습니다 — 필요하시면
`sourceUrl` 검사와 같은 패턴을 `filename`에도 추가하는 건 몇 줄짜리 작업입니다.

---

## 18. `image_path`/로그 — Supabase 전용으로 전환 (로컬 폴백 완전 제거)

**변경 파일**: `lib/storage/imageStore.ts`, `lib/logging/analysisLogger.ts`

요청하신 대로 이미지·로그 둘 다 **로컬 디스크에는 아무것도 안 쓰고 Supabase에만**
저장하도록 바꿨습니다.

- `imageStore.ts`: `saveToLocalDisk()` 함수 자체를 삭제. `saveAnalyzedImage()`는
  이제 `saveToSupabase()` 하나만 호출하고, 실패/미설정 시 `null`을 반환합니다
  (분석 자체는 계속 성공 — best-effort 원칙 유지). 이제 `image_path`는 항상
  `supabase://analyzed-images/...` 형식이거나 `null`뿐이라, 리포트에서 지적했던
  "두 형식이 섞여 저장되는" 문제(finding #13)도 이 변경으로 같이 해결됐습니다.
- `analysisLogger.ts`: `writeLocalLog()`/`logFilePath()` 삭제. `logAnalysisEvent()`는
  Supabase `request_logs` insert 하나만 수행합니다.

**중요한 동작 변화 — 꼭 알아두셔야 할 것**: Supabase가 설정 안 된 환경(예: 아직
`.env.local`을 안 채운 새 로컬 클론)에서는 **이제 로그가 어디에도 안 남습니다**
(예전엔 최소한 로컬 파일엔 남았음). 대신 서버 콘솔에 아래 경고가 뜨도록
해뒀습니다:

```ts
console.warn("[analysisLogger] Supabase가 설정되지 않아 로그를 저장하지 못했습니다", record.request_id);
```

11번 실제 테스트에서 이 변경도 같이 확인했습니다 — 4건의 테스트 요청이
`request_logs` 테이블에 실제로 들어간 것을 `supabase-js`로 직접 쿼리해서
확인했고, 로컬 `storage/logs/`에는 새 파일이 전혀 생기지 않았습니다.

기존에 이미 쌓여있던 `storage/uploads/`, `storage/logs/*.jsonl` 파일들은 그대로
남겨뒀습니다(삭제 요청은 없었고, 과거 기록이라 임의로 지우지 않는 게 안전하다고
판단했습니다) — 필요하시면 정리해드리겠습니다.

---

## 검증 (라운드 2)

```
npx tsc --noEmit -p tsconfig.json     # 통과
npx eslint app lib components types    # 통과 (scripts/는 프로젝트 eslint 설정에서 애초에 제외 대상)
npm run build                          # 통과
```

+ 위 11번에서 설명한 **실제 서버 2개를 띄운 통합 테스트**(대용량 거부/손상 이미지/
PNG 메타데이터 단축 경로/전체 흐름/Supabase 저장 확인)까지 전부 통과했습니다.

**참고**: `npm run lint`(인자 없는 `eslint .`)를 직접 돌리면 `ml/.venv/`(gitignore
대상, sklearn/torch가 번들한 JS 파일들) 안에서 무관한 경고 74건 + 에러 1건이
같이 나옵니다 — 이건 이번 변경과 무관한 로컬 Python 가상환경 내용물이 우연히
스캔된 것뿐이라(리포지토리에 커밋되지 않음), 실제 프로젝트 코드 검증은 위처럼
`app lib components types`로 범위를 좁혀서 확인했습니다.

---

## 이번 라운드에서 다루지 않은 나머지 항목 (참고용)

리포트/이번 대화에 나왔지만 명시적으로 요청받지 않아 손대지 않은 항목들:

- **Critical #3** `lib/utils/score.ts`의 `toPercentageScore(1)` → 100%로 뒤집혀 표시되는 버그 (`app/page.tsx:74`)
- **High #4** `ml/backbone.py:158-160`의 `embedding_dim()` 트루씨니스 크래시 위험
- Gemini 클라이언트 타임아웃 미설정 (`lib/vision/gemini.ts` — Anthropic/OpenAI는 있음)
- `metadata.ts`의 `png_metadata_found`가 청크 유무와 무관하게 항상 true인 죽은 분기
- `filename`이 플러밍만 되고 AI 키워드 매칭엔 미사용 (17번에서 설명만 함, 구현은 안 함)
- `ensureBucket()`이 `getBucket()` 실패를 캐싱 안 해서 권한 문제 시 매 요청 반복
- PNG `zTXt` 청크 미지원 (15번에서 새로 발견 — 실무 영향은 낮다고 판단해 보류)
- pgvector 유사 이미지 판정을 aggregator 점수에 실제로 반영하는 것 (16.7절 참고 — 인프라만 구축, 점수 반영은 별도 설계 필요)
