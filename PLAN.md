# Imalytix Next.js — 프로젝트 개발 계획서

> 기존 Vite+FastAPI 구조에서 **Next.js 단일 스택**으로 전환  
> 작성일: 2026-07-18

---

## 1. 기술 스택

| 역할 | 기술 |
|------|------|
| 프레임워크 | Next.js 15 (App Router) |
| 언어 | TypeScript |
| 스타일 | Tailwind CSS v4 |
| 이미지 처리 | sharp (Node.js) |
| pHash | sharp + DCT 수동 구현 or `imghash` |
| EXIF 파싱 | exifr |
| OpenAI | openai (npm) |
| Gemini | @google/genai (신규 통합 SDK; @google/generative-ai는 thinkingConfig 미지원으로 교체됨) |
| Claude | @anthropic-ai/sdk |
| DB (트래킹/캐시) | Turso (SQLite on Edge, 무료 플랜) |
| 배포 | Vercel |

---

## 2. 환경변수 (.env.local)

```env
# Vision LLM API Keys
OPENAI_API_KEY=sk-proj-...  # 실제 값은 .env.local 참고 (커밋 금지)
OPENAI_VISION_MODEL=gpt-4o

GEMINI_API_KEY=...  # 실제 값은 .env.local 참고 (커밋 금지)
GEMINI_VISION_MODEL=gemini-2.5-flash

ANTHROPIC_API_KEY=sk-ant-api03-...  # 실제 값은 .env.local 참고 (커밋 금지)
ANTHROPIC_VISION_MODEL=claude-haiku-4-5-20251001

# 이미지 설정
MAX_FILE_SIZE_MB=10
IMAGE_LONG_SIDE=1024
REQUEST_TIMEOUT_SECONDS=60

# Turso (추후 발급)
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=

# 앱 설정
APP_ENV=local
```

---

## 3. 프로젝트 구조

```
imalytix-nextjs/
├── app/
│   ├── layout.tsx                      # 루트 레이아웃 + 폰트
│   ├── page.tsx                        # 메인 업로드 + 결과 페이지
│   ├── globals.css
│   └── api/
│       ├── analyze/
│       │   ├── image/route.ts          # POST - 파일 업로드 분석
│       │   └── image-url/route.ts      # POST - URL 이미지 분석
│       └── health/route.ts             # GET - 헬스체크
│
├── components/
│   ├── layout/
│   │   └── AppHeader.tsx
│   ├── upload/
│   │   └── ImageUploader.tsx
│   └── results/
│       ├── ProviderResultCard.tsx
│       ├── MetadataResultCard.tsx
│       ├── RecommendationPanel.tsx
│       └── AnalysisStepsLoader.tsx
│
├── lib/
│   ├── vision/
│   │   ├── openai.ts                   # GPT-4o 분석
│   │   ├── gemini.ts                   # Gemini 2.5-flash 분석
│   │   ├── anthropic.ts                # Claude Haiku 분석
│   │   └── prompts.ts                  # 프롬프트 (기존 이식)
│   ├── analysis/
│   │   ├── aggregator.ts               # 점수 집계 (기존 로직 이식)
│   │   ├── metadata.ts                 # EXIF + 메타데이터 분석
│   │   ├── phash.ts                    # pHash 생성
│   │   └── router.ts                   # 라우팅 정책
│   ├── image/
│   │   └── preprocess.ts               # sharp 이미지 전처리
│   └── db/
│       └── tracking.ts                 # Turso 트래킹
│
├── types/
│   └── analysis.ts                     # API 응답 타입 정의
│
├── .env.local                          # 환경변수 (gitignore)
├── .gitignore
├── next.config.ts
├── tailwind.config.ts
└── package.json
```

---

## 4. API Route 설계

### POST `/api/analyze/image`
```typescript
// Request: multipart/form-data
{ file: File, mode: "quick" | "standard" | "deep" }

// Response
{
  request_id: string,
  final_result: { is_ai_generated: boolean, ai_probability: number, label: string, confidence: string },
  vision_results: VisionResult[],
  metadata_analysis: MetadataResult,
  evidence_summary: string[],
  recommended_action: string
}
```

### POST `/api/analyze/image-url`
```typescript
// Request: application/json
{ image_url: string, mode: string }
```

### GET `/api/health`
```typescript
// Response
{ status: "ok", models: { openai: boolean, gemini: boolean, anthropic: boolean } }
```

---

## 5. 개발 Phase

### Phase 1 — 프로젝트 셋업 (Day 1)
- [ ] `npx create-next-app@latest imalytix-nextjs --typescript --tailwind --app`
- [ ] 패키지 설치: `sharp`, `openai`, `@google/genai`, `@anthropic-ai/sdk`, `exifr`
- [ ] `.env.local` 작성 (위 2번 내용)
- [ ] `types/analysis.ts` 작성 (기존 `analysis.ts` 이식)
- [ ] AppHeader 컴포넌트 이식

### Phase 2 — 이미지 처리 레이어 (Day 2)
- [ ] `lib/image/preprocess.ts` — sharp로 리사이즈 + JPEG 정규화
- [ ] `lib/analysis/phash.ts` — pHash 생성
- [ ] `lib/analysis/metadata.ts` — exifr로 EXIF 파싱, AI 툴 감지
- [ ] `lib/analysis/router.ts` — 라우팅 정책 (기존 router_policy.py 이식)

### Phase 3 — Vision LLM 3종 연동 (Day 3)
- [ ] `lib/vision/prompts.ts` — 프롬프트 이식 (기존 prompts.py 내용 그대로)
- [ ] `lib/vision/openai.ts` — GPT-4o 분석
- [ ] `lib/vision/gemini.ts` — Gemini 2.5-flash 분석
- [ ] `lib/vision/anthropic.ts` — Claude Haiku 분석
- [ ] `Promise.all()` 병렬 호출 구현

### Phase 4 — 점수 집계 (Day 4)
- [ ] `lib/analysis/aggregator.ts` — 기존 aggregator_service.py 이식
- [ ] 합의 보너스 로직 (is_ai_generated 필드 반영)
- [ ] `/api/analyze/image/route.ts` 전체 파이프라인 연결

### Phase 5 — 프론트엔드 UI (Day 5-6)
- [ ] `app/page.tsx` — 히어로 섹션 + 업로드 존
- [ ] `ImageUploader.tsx` 이식
- [ ] `ProviderResultCard.tsx` 이식
- [ ] `MetadataResultCard.tsx` 이식
- [ ] `RecommendationPanel.tsx` 이식
- [ ] `AnalysisStepsLoader.tsx` 이식
- [ ] `/api/analyze/image-url/route.ts` 구현

### Phase 6 — 트래킹 (Day 7, 선택)
- [ ] Turso 계정 생성 및 DB 발급
- [ ] `lib/db/tracking.ts` — pHash + 분석결과 저장
- [ ] 환경변수 `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` 설정

### Phase 7 — Vercel 배포 (Day 8)
- [ ] `next.config.ts` 설정 (이미지 도메인, 함수 타임아웃)
- [ ] Vercel CLI 배포 또는 GitHub 연동 자동 배포
- [ ] Vercel 대시보드 환경변수 설정

---

## 6. 기존 Python 로직 → TypeScript 이식 대응표

| Python (기존) | TypeScript (Next.js) |
|---------------|----------------------|
| `PIL.Image` | `sharp` |
| `imagehash.phash()` | sharp + DCT 직접 구현 |
| `exifread` | `exifr` (npm) |
| `asyncio.gather()` | `Promise.all()` |
| `sqlite3` | `@libsql/client` (Turso) |
| `httpx.AsyncClient` | `fetch()` (built-in) |
| `pydantic.BaseModel` | TypeScript interface/type |
| `fastapi.UploadFile` | `request.formData()` |

---

## 7. 주의사항

- **Vercel 함수 실행 제한**: Hobby 10초, Pro 60초. 현재 분석 3~8초 → 여유 있음
- **sharp는 Node.js 전용**: `next.config.ts`에서 `serverComponentsExternalPackages: ['sharp']` 설정 필요
- **exifr**: 브라우저/Node.js 양쪽 지원, Next.js에서 바로 사용 가능
- **Turso 무료 플랜**: DB 9개, 월 500 read/write 단위 (MVP 충분)
- **이미지 처리는 반드시 Server side** (`use server` 또는 API Route): sharp는 클라이언트에서 실행 불가

---

## 8. 참고 — 기존 프로젝트

- 위치: `C:\Users\cubix\Desktop\성윤`
- GitHub: https://github.com/Imalytix/imalytix
- 기존 프롬프트: `app/services/vision_models/prompts.py` (이식 대상)
- 기존 집계 로직: `app/services/aggregator_service.py` (이식 대상)
