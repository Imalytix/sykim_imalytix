# Imalytix — 익스텐션 ↔ 웹서비스 API 명세서

> 대상: Chrome 익스텐션(`extensions/chrome/`)이 웹서비스(`imalytix-nextjs`)를 호출할 때 사용하는 API.
> 익스텐션 소스코드는 사용자가 "압축해제된 확장 프로그램 로드"로 전체를 열어볼 수 있고,
> Chrome 웹스토어에 올라가면 누구나 다운로드해서 까볼 수 있습니다 — **익스텐션 안에는
> 비밀값(API 키, 서버 내부 로직)이 전혀 없어야 하며, 여기 정리된 것들은 전부 "외부에
> 공개돼도 되는 공개 API"라는 전제로 설계되어 있습니다.**

## 기본 정보

| 항목 | 값 |
|---|---|
| Base URL (로컬 개발) | `http://localhost:3000` |
| Base URL (프로덕션) | 커스텀 도메인 확정 전까지 Vercel 배포 도메인 |
| 인증 | 없음 (비로그인 호출) — 요청에 세션 쿠키가 없으므로 서버는 항상 `user_id = null`로 기록 |
| Rate Limit | IP당 10분에 20회 (초과 시 `429` + `Retry-After` 헤더) |
| CORS | `chrome-extension://` origin만 허용 (`lib/net/cors.ts`) — 일반 웹사이트에서 직접 호출 불가 |

## `POST /api/analyze/image-url`

이미지 URL을 분석합니다. 익스텐션이 실제로 호출하는 유일한 엔드포인트입니다(`extensions/chrome/sidepanel.js`의 `analyze()` 함수).

### Request

```
POST /api/analyze/image-url
Content-Type: application/json
```

```json
{
  "image_url": "https://example.com/photo.jpg",
  "mode": "standard"
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `image_url` | string | ✅ | 분석할 이미지의 공개 URL. 사설 IP·loopback 대상은 서버에서 차단됨(SSRF 방어) |
| `mode` | `"quick"` \| `"standard"` \| `"deep"` | ❌ (기본 `standard`) | 분석 깊이 — 어떤 비전 모델을 부를지 결정 |

- 본문 크기 제한: 16KB
- 이미지 자체 크기 제한: `MAX_FILE_SIZE_MB`(기본 10MB), 다운로드 타임아웃 `REQUEST_TIMEOUT_SECONDS`(기본 60초)

### Response — `200 OK`

```json
{
  "product": "Imalytix",
  "request_id": "req_20260805_120000_abcdef",
  "mode": "standard",
  "input": {
    "type": "image_url",
    "mime_type": "image/jpeg",
    "width": 1024,
    "height": 768,
    "phash": "a1b2c3d4e5f6a7b8"
  },
  "analyzed_image_data_url": "data:image/jpeg;base64,...",
  "final_result": {
    "is_ai_generated": true,
    "ai_probability": 78,
    "label": "AI 생성 의심",
    "confidence": "medium"
  },
  "metadata_analysis": { "...": "EXIF/PNG/C2PA 분석 결과, types/analysis.ts의 MetadataAnalysis 참고" },
  "vision_results": [
    {
      "provider": "openai",
      "model_name": "gpt-4o",
      "is_ai_generated": true,
      "score": 0.8,
      "confidence": "medium",
      "evidence": [{ "type": "anatomy", "label": "...", "severity": "medium", "description": "..." }],
      "suspicious_regions": [{ "label": "...", "severity": "medium", "description": "...", "bbox": { "x1": 0.1, "y1": 0.2, "x2": 0.5, "y2": 0.6 } }],
      "limitations": [],
      "latency_ms": 3200,
      "usage": { "input_tokens": 1200, "output_tokens": 80, "cost_usd": 0.006 }
    }
  ],
  "evidence_summary": ["..."],
  "suspicious_regions": [{ "...": "vision_results의 suspicious_regions를 취합" }],
  "limitations": ["AI 생성 여부는 100% 단정할 수 없습니다.", "..."],
  "recommended_action": "AI 생성 의심 이미지입니다. 원본 출처와 추가 정보를 확인하는 것이 좋습니다.",
  "duplicate_check": {
    "checked": true,
    "matches": [],
    "used_cached_result": false,
    "influenced_score": false
  }
}
```

전체 타입 정의는 `types/analysis.ts`의 `AnalysisResult`가 단일 소스입니다 — 이 문서와 실제 필드가 어긋나면 그쪽이 맞습니다.

### Response — 에러

| 상태코드 | 상황 | 본문 |
|---|---|---|
| `400` | `image_url` 누락, JSON 파싱 실패, 이미지 형식 불가(JPEG/PNG/WEBP 아님), SSRF 차단 대상 URL | `{ "detail": "사람이 읽을 메시지" }` |
| `413` | 요청 본문 16KB 초과 | `{ "detail": "요청 본문이 너무 큽니다." }` |
| `429` | Rate limit 초과 | `{ "detail": "..." }`, `Retry-After` 헤더 포함 |
| `500` | 서버 내부 오류 | `{ "detail": "이미지 분석 중 오류가 발생했습니다. ... (요청 ID: req_...)" }` — 내부 에러 메시지는 절대 노출 안 됨 |

## `OPTIONS /api/analyze/image-url`

CORS preflight. 브라우저가 자동으로 보내며, 익스텐션 코드가 직접 호출할 일은 없습니다.

## "웹에서 자세히 보기" — `GET /result/{request_id}`

API가 아니라 **브라우저 탭으로 여는 웹페이지**입니다 (JSON을 반환하는 API 엔드포인트 아님). 위 분석 응답의 `request_id`를 그대로 붙여서 새 탭으로 열면 됩니다:

```js
chrome.tabs.create({ url: `${apiBase}/result/${result.request_id}` });
```

- 로그인 불필요(익스텐션 분석은 항상 비로그인이라 `user_id`가 없는 요청만 이 경로로 조회 가능 — 로그인한 사용자의 비공개 기록은 이 URL로 절대 안 열립니다)
- **2026-08-05부터 상세 분석(provider별 breakdown, EXIF/C2PA, 유사 이미지 검색)은 이 페이지에서도 로그인 후에만 열립니다** — 요약(점수/핵심결과)까지는 비로그인으로 보이고, "로그인 후 자세한 분석 보기" 버튼을 눌러야 함

## 익스텐션이 절대 하면 안 되는 것

- ❌ `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY` 등 서버 전용 비밀값을 익스텐션 코드/설정에 넣는 것 — 위 두 엔드포인트는 그런 키 없이 호출 가능하도록 이미 설계돼 있습니다
- ❌ Supabase에 직접 연결(REST/RPC)해서 DB를 읽거나 쓰는 것 — 반드시 위 웹서비스 API를 거쳐야 함 (서버 쪽에서 rate limit·SSRF 방어·입력 검증을 전부 처리하기 때문)
- ❌ `manifest.json`의 `host_permissions`를 필요 이상으로 넓히는 것 — 현재 `localhost:3000`/`127.0.0.1:3000`만 허용(로컬 전용 정책 유지 중)

## 변경 이력

- 2026-08-05: 최초 작성. 현재 익스텐션이 실제로 쓰는 건 `/api/analyze/image-url` 하나뿐(파일 업로드 분석용 `/api/analyze/image`는 웹앱 전용, 익스텐션은 URL 기반이라 안 씀). 이후 API가 바뀌면 이 문서도 같이 갱신할 것.
