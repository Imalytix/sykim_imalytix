# DINO를 실시간 신호로 붙이고, 저장소를 Supabase로 옮기기

> 이 문서는 "그냥 됐다"가 아니라 "왜 이렇게 했는지"를 설명하는 데 집중합니다.
> 컴퓨터공학과 학부 수준의 지식(HTTP, 프로세스, 비동기 프로그래밍 기초)은
> 있다고 가정하고, 실무에서 이런 지식을 어떻게 조합해서 문제를 푸는지
> 보여드리는 게 목표입니다. 코드는 전부 이 저장소에 실제로 들어가 있는
> 파일이니, 파일 경로를 따라가서 직접 열어보시면 됩니다.

## 이 문서를 다 읽으면 할 수 있게 되는 것

- "느린 모델을 매번 새로 로드하지 않고 서비스에 붙이려면 어떻게 하지?"라는
  질문에 답할 수 있게 됩니다 (콜드 스타트 vs 웜 서버 패턴).
- 기존 코드를 한 줄도 안 건드리고 새 기능을 끼워넣는 설계(인터페이스 재사용)를
  실제 사례로 이해하게 됩니다.
- "이 저장 로직이 실패하면 전체 서비스가 죽나요?"라는 질문에 항상 "아니오"라고
  답할 수 있는 코드를 짜는 습관(best-effort 패턴)을 알게 됩니다.
- Supabase(혹은 아무 BaaS)를 실서비스에 진짜로 연결할 때 뭘 신경 써야 하는지
  (private 버킷, service_role 키, 자동 프로비저닝) 감을 잡게 됩니다.

---

## Part 1. DINO를 4번째 분석 신호로 붙이기

### 1.1 문제: "그냥 함수처럼 부르면 안 되나?"를 실측으로 반박하기

`ml/infer.py`는 이미 있었습니다 — 이미지 경로 하나 받아서 AI 생성 확률을
뱉는 스크립트. 제일 단순한 통합 방법은 Node.js에서 이 파이썬 스크립트를
그냥 프로세스로 실행하는 겁니다(`child_process.execFile`). 실제로 그렇게
시도해보기 전에, **먼저 시간을 재보는 게 중요합니다** — "될 것 같다"는
느낌으로 설계하면 나중에 크게 후회합니다.

```bash
$ time python infer.py data/building/real/-hXpKWsSrXw.jpg
real    0m23.445s
```

**23초.** 이미지 1장 분석하는 데 23초면, 사용자 입장에서는 서비스가 멈춘
겁니다. 왜 이렇게 오래 걸릴까요? `infer.py`가 하는 일을 순서대로 보면:

1. 파이썬 인터프리터 시작
2. `import torch` — PyTorch는 무거운 라이브러리라 이것만으로도 수 초
3. `torch.hub.load(...)`로 DINOv3 백본 구조를 불러오고, 로컬 `.pth` 체크포인트
   (86MB)를 읽어서 GPU/CPU 메모리에 올림
4. **그제서야** 실제 이미지 1장을 백본에 통과시켜서 임베딩을 뽑고, 로지스틱
   회귀로 예측 — 이 부분은 사실 수십 ms밖에 안 걸립니다

즉 **23초 중 22초 이상이 "준비 과정"이고, 진짜 계산은 순식간**입니다. 이걸
매 요청마다 반복하는 게 문제의 핵심입니다.

> 💡 **배울 점**: 성능 문제를 마주치면 "느리다"에서 멈추지 말고 "어느 부분이
> 느린가"를 먼저 재보세요. 여기서는 "모델 로딩"과 "모델 추론"이 완전히
> 분리되는 두 단계라는 걸 알면, 해결책이 저절로 보입니다 — **로딩은 한 번만,
> 추론은 매번.**

### 1.2 해결책: 모델을 미리 띄워두는 상주 서버 (`ml/serve.py`)

이건 실무에서 아주 흔한 패턴입니다. Flask/FastAPI 같은 프레임워크를 쓰는 게
보통이지만, 여기서는 의존성을 하나도 안 늘리려고 파이썬 표준 라이브러리
`http.server`만으로 만들었습니다. 프레임워크 없이도 HTTP 서버가 뭘 하는지
이해하기에 오히려 더 좋은 예제이기도 합니다.

**핵심 구조** (`ml/serve.py`):

```python
MODEL = None  # 전역 변수 — 서버가 켜져 있는 동안 딱 한 번만 채워짐

class InferHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        # 요청이 들어올 때마다 실행되는 부분 — 여기엔 "로딩"이 없음
        raw = self.rfile.read(length)
        emb = embed_image(tmp_path)          # 이미 로드된 모델 재사용
        proba = MODEL.predict_proba(...)      # 이것도 이미 로드된 모델 재사용
        self._respond(200, {"ai_probability": proba})

def main():
    global MODEL
    MODEL = joblib.load(args.model)   # 서버 시작 시 1회
    embedding_dim()                    # DINOv3 백본도 서버 시작 시 1회 워밍업
    server = ThreadingHTTPServer(("127.0.0.1", args.port), InferHandler)
    server.serve_forever()             # 여기서 계속 대기하며 요청을 처리
```

몇 가지 설계 선택을 짚어볼게요:

- **`ThreadingHTTPServer`를 쓴 이유**: 기본 `HTTPServer`는 요청을 한 번에
  하나씩만 처리합니다(요청 A 처리 중엔 요청 B가 줄 서서 기다림). DINO 추론이
  다른 3개 LLM 호출과 **동시에** 나가야 하는데(뒤에서 설명), 서버가 순차
  처리만 하면 병렬로 부르는 의미가 없어집니다. `ThreadingHTTPServer`는
  요청마다 스레드를 새로 띄워서 동시 처리를 가능하게 해줍니다.
- **왜 받은 이미지를 임시 파일로 썼다가 다시 읽나요?** `embed_image()`는
  원래 배치 스크립트(`extract_embeddings.py`)용으로 "파일 경로"를 인자로
  받게 짜여 있었습니다. 이 함수 시그니처를 바꾸면 기존 배치 스크립트도
  같이 손봐야 하니, 대신 받은 바이트를 임시 파일로 한 번 쓰고 그 경로를
  넘기는 쪽을 택했습니다. 디스크 왕복이 몇 ms 추가되지만, 모델 로딩(23초)에
  비하면 무시할 수준이고, **기존 함수를 안 건드리고 재사용**하는 게 훨씬
  가치 있는 트레이드오프입니다.
- **`GET /health`가 있는 이유**: 서버가 실제로 떠서 요청 받을 준비가
  됐는지 확인하는 용도입니다. 뒤에서 이 엔드포인트로 "서버 워밍업이 끝났는지"
  폴링했습니다 — 실무에서 로드밸런서나 오케스트레이터(K8s 등)가 컨테이너의
  준비 상태를 확인할 때 쓰는 것과 똑같은 패턴(헬스체크)입니다.

**실행 방법**:
```bash
cd ml
python serve.py              # 기본 포트 8765, 워밍업에 ~20초
# "추론 서버 실행 중: http://127.0.0.1:8765" 뜨면 준비 완료
```

### 1.3 Node.js에서 이 서버 부르기 (`lib/analysis/dino.ts`)

이제 Next.js 쪽에서 할 일은 그냥 이 서버에 HTTP 요청 하나 보내는 것뿐입니다.

```typescript
const response = await fetch(`${DINO_SERVICE_URL}/infer`, {
  method: "POST",
  headers: { "Content-Type": "application/octet-stream" },
  body: new Uint8Array(imageBuffer),
  signal: AbortSignal.timeout(10_000),   // 10초 안에 안 오면 포기
});
```

여기서 배울 만한 두 가지:

**1) `AbortSignal.timeout(10_000)`** — 최신 JS에 내장된 타임아웃 기능입니다.
예전엔 `Promise.race([fetch(...), timeoutPromise])` 같은 걸 직접 짜야
했는데, 지금은 `fetch`의 `signal` 옵션에 이거 하나만 넘기면 알아서
`AbortError`를 던져줍니다. **왜 타임아웃이 필요한가**: 만약 `ml/serve.py`가
안 켜져 있으면 `fetch`는 무한정 응답을 기다릴 수도 있는데, 그러면 이
분석 요청 전체가 멈춰버립니다. 타임아웃은 "이 신호 하나가 실패해도 전체
분석은 계속 진행되게" 만드는 안전장치입니다.

**2) 왜 `VisionResult` 타입으로 감쌌는가** — 이게 이 통합에서 가장 중요한
설계 결정입니다. `dino.ts`의 반환 타입을 보면:

```typescript
export async function analyzeWithDino(imageBuffer: Buffer): Promise<VisionResult> {
```

`VisionResult`는 원래 OpenAI/Gemini/Claude 3개 LLM의 응답을 표현하려고
만든 타입입니다(`types/analysis.ts`). DINO는 LLM이 아니라 완전히 다른
종류의 모델(임베딩 + 로지스틱회귀)인데도 **일부러 같은 타입으로 흉내를
냈습니다.** 왜냐하면 `lib/analysis/aggregator.ts`(점수를 합산하는 로직)가
이미 "`vision_results` 배열 안에 있는 건 뭐든 가중평균하고, 2개 이상
합의하면 보너스 주고, evidence 모으고..." 하는 로직을 provider 이름에
상관없이 일반적으로 짜여 있었기 때문입니다.

```typescript
// aggregator.ts — 이 코드는 이번에 단 한 줄도 안 바뀌었습니다
const validVision = visionResults.filter((r) => !r.is_mock);
for (const result of validVision) {
  const weight = CONFIDENCE_WEIGHTS[result.confidence] ?? 0.4;
  // ... provider가 "openai"든 "dino"든 상관없이 똑같이 처리됨
}
```

그 결과, DINO를 4번째 신호로 추가하는 작업의 **진짜 통합 코드는
`pipeline.ts`에 한 줄 추가한 게 전부**였습니다. `aggregator.ts`는 이미
"provider가 몇 개든, 뭐가 됐든" 처리하도록 짜여 있었으니까요.

> 💡 **배울 점**: 이건 객체지향에서 말하는 **개방-폐쇄 원칙**(확장에는
> 열려있고, 수정에는 닫혀있어야 한다)의 실제 사례입니다. `aggregator.ts`를
> "구체적인 provider 3개"가 아니라 "VisionResult라는 인터페이스를 만족하는
> 아무개"를 대상으로 짜놨기 때문에, 4번째·5번째 신호가 추가돼도 기존 코드를
> 안 건드리고 확장할 수 있었습니다. 반대로 만약 `aggregator.ts`에
> `if (provider === "openai") {...} else if (provider === "gemini") {...}`
> 식으로 하드코딩돼 있었다면, DINO 붙일 때마다 그 분기문을 계속 늘려야
> 했을 겁니다.

**신뢰도(confidence)는 어떻게 정했나** — LLM은 자기가 "얼마나 확신하는지"를
프롬프트에 답하게 시켰지만, DINO는 그런 식으로 물어볼 대상이 없습니다(그냥
숫자 하나 뱉는 분류기). 대신 **확률이 0.5(모르겠음)에서 얼마나 먼지**로
신뢰도를 유도했습니다:

```typescript
function confidenceFromProbability(p: number): "low" | "medium" | "high" {
  const distance = Math.abs(p - 0.5);
  if (distance >= 0.35) return "high";   // 15% 미만 or 85% 초과 — 확신
  if (distance >= 0.15) return "medium"; // 35~65% 사이가 아니면 — 어느 정도
  return "low";                          // 0.5에 가까움 — 진짜 애매함
}
```

이건 통계에서 "결정 경계(decision boundary)로부터의 거리"라는 흔한 개념을
그대로 코드로 옮긴 겁니다.

**실패 처리** — 서버가 꺼져있거나 타임아웃이 나면 어떻게 될까요:

```typescript
} catch (error) {
  return {
    provider: "dino",
    is_ai_generated: null,
    score: 0.5,
    confidence: "low",
    // ...
    is_mock: true,   // ← 이게 핵심
    error_message: `DINO 추론 서버 연결 실패...`,
  };
}
```

`is_mock: true`를 달아서 반환하면, `aggregator.ts`의
`visionResults.filter((r) => !r.is_mock)`에 걸려서 **집계 계산에서 자동으로
제외**됩니다. 즉 DINO 서버가 꺼져 있어도 나머지 3개 LLM으로 정상 분석되고,
에러가 사용자에게 그대로 노출되지도 않습니다 — 이게 "우아한 실패
(graceful degradation)"입니다. 에러를 던지는(`throw`) 대신 "실패했다는
정보를 담은 정상적인 값"을 반환하는 이 패턴은, 이 프로젝트 전체에서
반복적으로 쓰인 스타일입니다(뒤에서 Storage/로그 코드에서도 또 나옵니다).

### 1.4 파이프라인에 끼워넣기 (`lib/analysis/pipeline.ts`)

```typescript
if (process.env.IMALYTIX_ENABLE_DINO === "true") {
  providerCalls.push(analyzeWithDino(preprocessed.buffer));
}
```

3개 LLM과 나란히 `providerCalls` 배열에 들어가서, 바로 아래
`Promise.all(providerCalls)`로 **전부 동시에** 호출됩니다 — 순차 호출이면
4개를 더한 시간이 걸리지만 병렬 호출이면 가장 느린 것 하나의 시간만
걸립니다.

**왜 opt-in(`=== "true"`일 때만 켜짐)으로 만들었나** — LLM 3개는 API 키가
없으면 그냥 그 provider만 호출을 안 합니다(설정 안 한 사람의 문제, 무해함).
근데 DINO는 다릅니다 — `IMALYTIX_ENABLE_DINO`가 켜져 있는데 `ml/serve.py`가
안 떠 있으면, **모든 분석 요청마다 10초 타임아웃을 기다리게** 됩니다. 이건
꽤 크게 사용자 경험을 해치는 문제라서, 기본값을 "꺼짐"으로 두고
로컬에서 명시적으로 켠 사람만 그 리스크를 감수하게 설계했습니다.

### 1.5 실제 테스트 결과

로컬에서 두 서버(`npm run dev`, `python serve.py`)를 띄우고 curl로 직접
쏴봤습니다:

```bash
# AI로 생성된 이미지(DiffusionDB 샘플)
$ curl -X POST http://localhost:3000/api/analyze/image -F "file=@item_0.png" -F "mode=quick"
→ dino.score = 0.9955 (99.6% AI로 판정, confidence=high)
→ final_result.ai_probability = 100

# 실제 사진(Unsplash 샘플)
$ curl -X POST http://localhost:3000/api/analyze/image -F "file=@misc_real.jpg" -F "mode=quick"
→ dino.score = 0.0041 (0.4% AI로 판정, confidence=high)
→ final_result.ai_probability = 17
```

두 경우 다 정확했고, `vision_results` 배열에 `"dino"`가 4번째 항목으로
정상적으로 섞여 들어갔습니다. 전체 응답 시간은 4개 신호를 병렬로 불렀을 때
약 10초 — DINO 자체는 워밍업된 상태라 순식간이고, 병목은 여전히 LLM
호출 쪽입니다.

---

## Part 2. Supabase Storage로 이미지 저장소 옮기기

### 2.1 문제: Vercel엔 "로컬 디스크"가 없다 (사실은 있는데 사라진다)

기존 `imageStore.ts`는 분석한 이미지를 `storage/uploads/날짜/요청ID.jpg`로
저장했습니다. 로컬에서 `npm run dev`로 계속 켜놓고 쓰면 문제가 없는데,
**Vercel 같은 서버리스 환경은 요청이 끝나면 그 실행 환경 자체가 사라집니다**
— 다음 요청은 완전히 새 컨테이너에서 시작되고, 방금 그 컨테이너에 썼던
파일은 그냥 없어집니다. 즉 지금 코드 그대로 Vercel에 배포하면, 분석은
정상적으로 되지만 **저장된 이미지는 몇 초 뒤에 증발**합니다.

해결책은 "파일을 로컬 디스크가 아니라, 요청이 끝나도 살아있는 외부
저장소(Supabase Storage)에 쓰는 것"입니다.

### 2.2 버킷을 코드로 자동 생성하기

Supabase Storage에서 "버킷"은 파일 시스템의 최상위 폴더 같은 개념입니다.
보통은 대시보드에서 클릭해서 만드는데, `service_role` 키(관리자 권한)로는
**코드에서도 만들 수 있습니다**:

```typescript
let bucketEnsured = false;  // 서버 켜져 있는 동안 한 번만 확인하면 됨

async function ensureBucket(supabase: SupabaseClient): Promise<void> {
  if (bucketEnsured) return;
  const { data: existing } = await supabase.storage.getBucket(BUCKET_NAME);
  if (!existing) {
    const { error } = await supabase.storage.createBucket(BUCKET_NAME, {
      public: false,          // 아무나 URL로 못 열어보게
      fileSizeLimit: "10MB",
    });
    if (error && !error.message.toLowerCase().includes("already exists")) {
      throw error;
    }
  }
  bucketEnsured = true;
}
```

- **`bucketEnsured` 플래그**: `ml/serve.py`의 `MODEL` 전역 변수와 똑같은
  아이디어입니다 — "비용이 드는 확인 작업(네트워크 호출)을 매 요청마다
  반복하지 말고, 한 번 확인했으면 그 결과를 기억해두자."
- **"already exists" 에러를 무시하는 이유**: 동시에 여러 요청이 들어오면,
  둘 다 `getBucket()`에서 "없음"을 보고 둘 다 `createBucket()`을 시도할 수
  있습니다. 이런 걸 **경쟁 상태(race condition)**라고 부르는데, 둘 중 하나는
  "이미 있음" 에러를 받게 됩니다. 이건 진짜 실패가 아니라 그냥 경쟁에서 진
  것뿐이니, 이 특정 에러 메시지만 무시하고 넘어갑니다.

이 방식 덕분에 사용자가 Supabase 대시보드에서 버킷을 수동으로 만들 필요가
전혀 없습니다 — 실제로 이번 세션에서 직접 검증했는데, 코드 배포 후 첫
분석 요청 한 번에 버킷이 자동으로 생기고 그 안에 파일도 정상적으로
들어갔습니다.

### 2.3 primary/fallback 패턴

```typescript
export async function saveAnalyzedImage(requestId: string, buffer: Buffer): Promise<string | null> {
  const supabasePath = await saveToSupabase(requestId, buffer);
  if (supabasePath) return supabasePath;
  return saveToLocalDisk(requestId, buffer);   // Supabase 실패/미설정 시 폴백
}
```

Supabase 환경변수가 없거나(`.env.local` 미설정), 업로드가 실패하면 그냥
예전처럼 로컬 디스크에 씁니다. 이 계층 구조 덕분에:
- Supabase를 아직 설정 안 한 팀원도 로컬 개발이 그대로 됩니다.
- Supabase가 일시적으로 느리거나 장애가 나도, 분석 자체는 계속 성공합니다
  (다만 그 요청의 이미지는 로컬에만 남음 — Vercel이면 그마저도 휘발되지만,
  "이미지 저장 실패"가 "분석 실패"로 번지지는 않습니다).

### 2.4 Private 버킷과 `service_role` 키

버킷을 `public: false`로 만든 이유는, 사용자가 올린 이미지가 URL만 알면
누구나 볼 수 있는 상태가 되면 안 되기 때문입니다(개인정보/민감 이미지일
수 있음). 대신 **서버 코드만 가진 `service_role` 키**로 업로드/조회하고,
나중에 그 이미지를 실제로 화면에 보여줘야 할 일이 생기면 **서명된 URL
(signed URL)**을 발급해서 씁니다 — 몇 분/시간짜리 임시 링크를 만들어주는
방식입니다:

```typescript
// 지금 코드엔 없지만, 나중에 필요해지면 이렇게 쓰면 됩니다
const { data } = await supabase.storage
  .from("analyzed-images")
  .createSignedUrl("2026-07-22/req_xxx.jpg", 60 * 5); // 5분간 유효
```

지금은 이미지를 다시 꺼내 보는 기능이 없어서 이 부분은 구현 안 했지만,
필요해지면 이 한 함수만 추가하면 됩니다.

### 2.5 검증

직접 Supabase JS 클라이언트로 확인했습니다:

```
버킷 목록: [ { name: 'analyzed-images', public: false } ]
2026-07-22 폴더 내용: [ 'req_20260722_134402_cff1ba.jpg' ]
```

그리고 같은 요청이 로컬 `storage/uploads/`에는 **새로 안 생겼다**는 것도
확인했습니다 — 즉 폴백이 아니라 Supabase 경로가 정상적으로 우선 사용됐다는
뜻입니다.

---

## Part 3. 로그도 Supabase에 — "이미지랑 로그 둘 다 저장해야 하는 거 아니야?"

정확한 지적이었습니다. 이미지 파일만 옮기고 로그(`storage/logs/*.jsonl`)를
그대로 두면, **Vercel에서 로그도 이미지와 똑같은 이유로 사라집니다.** 둘 다
"로컬 파일시스템에 쓴다"는 같은 문제를 갖고 있었으니까요.

### 3.1 `request_logs` 테이블 — `images` 테이블과 뭐가 다른가

지난번에 pHash를 저장하는 `images` 테이블을 만들 때, `bit(64)` 타입 때문에
꽤 고생했습니다(hex 문자열을 SQL 함수 없이는 못 넣어서 RPC 함수를 따로
만들어야 했음, `supabase/schema.sql` 참고). 로그 테이블은 그런 특수 타입이
전혀 없습니다 — 전부 `text`/`jsonb`/`numeric`이라, **RPC 함수 없이
`supabase-js`로 바로 넣을 수 있습니다**:

```typescript
const { error } = await supabase.from("request_logs").insert(record);
```

이게 됩니다. `images` 테이블 때는 왜 이게 안 됐었는지 다시 짚으면 —
문제는 PostgreSQL의 `bit` 타입 자체가 까다로운 거였지, "RPC냐 직접
insert냐"가 원래 정해진 규칙은 아닙니다. **테이블에 어떤 타입을 쓰는지가
클라이언트 코드의 복잡도를 결정한다**는 걸 두 사례를 비교하면서 배울 수
있습니다.

### 3.2 코드가 하나로 합쳐진 이유 — 레코드 재사용

```typescript
function buildLogRecord(entry: AnalysisLogEntry): Record<string, unknown> {
  // ... 로컬/Supabase 둘 다 쓸 수 있는 공통 객체 하나를 만듦
}

export async function logAnalysisEvent(entry: AnalysisLogEntry): Promise<void> {
  const record = buildLogRecord(entry);
  await Promise.all([writeLocalLog(record), writeSupabaseLog(record)]);
}
```

로그 내용을 만드는 로직(`buildLogRecord`)을 딱 한 군데에만 써두고, 로컬
파일 쓰기와 Supabase insert가 **같은 데이터**를 각자의 방식으로 저장하게
만들었습니다. 만약 이 로직을 두 번 따로 썼다면, 나중에 "로그에 필드 하나
추가해야지" 할 때 두 곳을 다 고쳐야 하고, 하나를 깜빡하면 로컬 로그와
클라우드 로그 내용이 슬금슬금 달라지는 버그가 생깁니다.

`Promise.all([...])`로 두 저장을 **동시에** 실행하는 것도 포인트입니다 —
순차로 하면(`await writeLocalLog(); await writeSupabaseLog();`) 둘의 시간이
더해지지만, 동시에 하면 둘 중 느린 쪽 시간만 걸립니다. 그리고
`writeLocalLog`/`writeSupabaseLog` 둘 다 내부에서 자기 에러를 own
try/catch로 잡기 때문에, **하나가 실패해도 다른 하나는 영향 안 받습니다**
(pHash 저장·이미지 저장에서도 계속 나왔던 그 best-effort 패턴입니다).

### 3.3 아직 남은 수동 단계

`supabase/schema.sql`에 `request_logs` 테이블 정의를 추가해뒀는데, 이건
직접 실행할 방법이 없어서(제가 Supabase 대시보드에 접속할 수단이 없음)
**Supabase 대시보드 → SQL Editor에서 `supabase/schema.sql` 전체를 다시
한번 실행**해주셔야 합니다. `create table if not exists`라서 기존
`images` 테이블/함수는 그대로 두고 `request_logs`만 새로 생깁니다.

이거 실행 전까지는 어떻게 되냐면, 실제로 테스트해봤습니다:

```
예상되는 에러(테이블 아직 없음): Could not find the table 'public.request_logs' in the schema cache
```

콘솔에 저 에러가 찍히긴 하지만(`console.error`), **분석 자체는 정상
완료됩니다** — best-effort 패턴이 여기서도 그대로 작동하는 걸 실제로
확인한 겁니다. SQL 실행하시면 그 다음 요청부터 바로 로그가 쌓입니다.

---

## Part 4. 직접 재현해보기

**1) 두 서버 띄우기** (터미널 2개 필요)
```bash
# 터미널 1
npm run dev

# 터미널 2
cd ml
python serve.py     # "추론 서버 실행 중" 뜰 때까지 대기 (~20초)
```

**2) `.env.local` 확인**
```
IMALYTIX_ENABLE_DINO=true
IMALYTIX_DINO_SERVICE_URL=http://127.0.0.1:8765
```

**3) 분석 요청 날려보기**
```bash
curl -X POST http://localhost:3000/api/analyze/image \
  -F "file=@아무이미지.jpg" -F "mode=quick"
```
응답 JSON의 `vision_results` 배열 안에 `"provider": "dino"` 항목이 있으면
성공입니다.

**4) Supabase 대시보드에서 확인**
- Storage → `analyzed-images` 버킷 → 오늘 날짜 폴더에 방금 분석한 이미지가
  있는지
- (schema.sql 재실행 후) Table Editor → `request_logs` → 방금 요청의 행이
  쌓였는지

---

## Part 5. 오늘 배운 기법 정리

| 기법 | 어디 썼나 | 왜 좋은가 |
|---|---|---|
| 콜드 스타트 분리 (로딩 1회 + 추론 N회) | `ml/serve.py` | 무거운 초기화 비용을 요청마다 반복하지 않음 — ML 서빙에서 표준 패턴 |
| 전역 캐시 플래그 (`MODEL`, `bucketEnsured`) | `serve.py`, `imageStore.ts` | "한 번 확인/로드했으면 다시 하지 않기"를 가장 간단하게 구현하는 방법 |
| 인터페이스 재사용을 통한 무변경 확장 | `dino.ts`가 `VisionResult` 흉내 | 기존 집계 로직(`aggregator.ts`)을 한 줄도 안 건드리고 4번째 신호 추가 |
| `AbortSignal.timeout()` | `dino.ts` | 외부 의존성 하나가 멈춰도 전체 요청이 무한정 안 걸리게 하는 안전장치 |
| Best-effort / graceful degradation | `dino.ts`, `imageStore.ts`, `analysisLogger.ts` 전부 | 부가 기능(저장, 로깅, 4번째 신호)의 실패가 핵심 기능(분석)을 절대 못 막게 |
| primary/fallback 저장소 | `imageStore.ts` | 외부 서비스 장애/미설정 시에도 로컬로 계속 동작 |
| 자동 프로비저닝 (`ensureBucket`) | `imageStore.ts` | 사용자가 대시보드 클릭 안 해도 되게 — 수동 단계를 코드로 흡수 |
| 레코드 빌더 공유 + 병렬 dual-write | `analysisLogger.ts` | 두 저장소가 같은 데이터를 갖도록 보장하면서, 시간은 더하지 않고 겹치게 씀 |
| opt-in 환경변수 설계 | `pipeline.ts`의 `IMALYTIX_ENABLE_DINO` | "꺼져 있는 게 기본"으로 둬서, 준비 안 된 환경에서 매 요청 지연이 생기는 걸 방지 |

이 패턴들은 DINO나 Supabase에 한정된 게 아니라, **"느린/불안정한 외부
의존성을 서비스에 안전하게 끼워넣는 법"**이라는 하나의 일반적인 문제에
대한 답들입니다. 나중에 Google Vision API를 붙이거나, 다른 ML 모델을
추가하거나, 완전히 다른 프로젝트를 할 때도 그대로 재사용할 수 있는
사고방식이니, 여기서 "왜"를 이해해두시면 다음번엔 훨씬 빨리 짤 수 있을
겁니다.
