# 26-08-01(4) DINO/pgvector 제거 + 신규 Supabase 프로젝트 이식

> 배경: DINOv3(Module A) 성능이 불안정해서 프로젝트에서 완전히 제거하기로 결정.
> 그 임베딩을 저장/검색하던 pgvector 관련 스키마도 함께 제거. 동시에 새 Google
> 계정으로 만든 새 Supabase 프로젝트(`japnehqkkugoqkkhkmqy`)로 이식 작업 진행.

## ⚠️ 지금 바로 하셔야 하는 것

### 1) `SUPABASE_SERVICE_ROLE_KEY`가 아직 anon 키와 동일합니다 — DB 기록이 전부 막혀있습니다

`.env.local` 19행 `SUPABASE_SERVICE_ROLE_KEY`가 18행 `SUPABASE_ANON_KEY`와 **완전히 같은 값**입니다(며칠 전 코드리뷰에서 지적드렸던 문제가 아직 안 고쳐진 상태). 실제로 라이브 테스트해보니:

```
[verification] record_verification failed ... {
  code: '42501',
  message: 'new row violates row-level security policy for table "verification_requests"'
}
```

분석 자체(3-LLM 호출, 점수 산출, 화면 표시)는 정상 동작하지만, **DB에는 아무것도 기록되지 않고 있습니다** — 관리자 권한(service_role, RLS 우회)으로 써야 할 자리에 anon 권한(RLS 적용됨)으로 쓰려다 막히는 것입니다. `verification_requests`엔 anon/authenticated용 INSERT 정책을 아예 안 만들어뒀기 때문에(SELECT만 있음) 100% 막힙니다.

**해주셔야 하는 것**: Supabase 대시보드 → Settings → API → **Project API keys**에서 `service_role`(secret 표시) 키를 복사해서 `.env.local` 19행에 넣어주세요. 넣으신 뒤 알려주시면 서버 재시작하고 다시 검증하겠습니다.

### 2) SQL Editor에서 `supabase/schema.sql` 재실행

이번 라운드에서 세 가지가 바뀌었습니다 — 재실행하면 자동으로 반영됩니다(전부 idempotent):

- `request_images.embedding`, HNSW 인덱스, `find_similar_by_embedding` 함수 **삭제** (DINO 제거)
- `ai_provider_calls.provider` / `verification_evidence.source` CHECK에서 `'dino'` 제거
- `verification_requests.client_id`, `feedback.ip`/`feedback.user_agent` 컬럼 보강 (담당 개발자분이 구축하신 DB에 빠져있던 컬럼들 — 아래 "발견한 것" 참고)

## 발견한 것 — 담당 개발자분이 구축하신 DB와 우리 schema.sql의 차이

전달해주신 스키마 덤프를 이 프로젝트의 `supabase/schema.sql`과 대조한 결과:

| 테이블 | 차이 |
|---|---|
| `verification_requests` | `client_id` 컬럼 없음 (지난 라운드 통계 작업 때 추가한 컬럼 — 타이밍 차이로 보임) |
| `request_images` | `embedding` 컬럼 없음 → **DINO/pgvector 제거 결정과 일치하는 것으로 확인, 의도된 차이로 확정** |
| `feedback` | `ip`, `user_agent` 컬럼 없음 |
| 나머지(`users`, `ai_provider_calls`, `verification_evidence`, `verification_results`) | 컬럼 구성 완전히 일치 |

`schema.sql`을 재실행하면 위 gap이 전부 채워지고, `embedding`은 저희 쪽에서도 제거했으니 앞으로 두 스키마가 다시 갈라질 일은 없습니다.

## 이번에 한 일

### 1) 잘못된 브랜치 문제 수정

세션 도중 로컬 체크아웃이 `research/dino`가 아니라 보존용으로 만들어둔 `archive/dino-pgvector` 브랜치로 되어 있었습니다 — 오늘 작업한 로그인/마이페이지/스키마 v2 관련 미커밋 변경사항 전부가 "손대면 안 되는" 스냅샷 브랜치 위에 얹혀 있었던 것입니다. 두 브랜치가 아직 완전히 같은 커밋(`b3fb7f3`)을 가리키고 있어서 손실 없이 `research/dino`로 되돌렸습니다. **`archive/dino-pgvector`는 앞으로 절대 체크아웃/커밋하지 마세요** — DINO 관련 코드 전체(`ml/`, `lib/analysis/dino.ts`, pgvector 스키마)가 그대로 보존된 스냅샷입니다. 나중에 DINO를 다시 붙이고 싶으면 이 브랜치에서 필요한 파일만 골라오면 됩니다.

### 2) 코드에서 DINO/pgvector 제거

| 파일 | 변경 |
|---|---|
| `lib/analysis/dino.ts` | 삭제 |
| `ml/` (Python 전체) | 삭제 (`archive/dino-pgvector`에 보존됨) |
| `lib/analysis/pipeline.ts` | DINO 호출, 임베딩 기반 2단계 유사도 검색 제거 — phash 검색만 남음 |
| `lib/analysis/aggregator.ts` | 임베딩 거리 임계값 로직 제거, phash 전용으로 단순화 |
| `lib/db/verification.ts` | `findSimilarByEmbedding`, `embeddingToVectorLiteral` 제거, `SimilarImageMatch`에서 `match_type` 필드 제거(항상 phash라 구분 불필요) |
| `types/analysis.ts` | `VisionResult.provider`에서 `"dino"` 제거 |
| `components/results/ProviderResultCard.tsx`, `extensions/chrome/sidepanel.js` | DINO 표시 이름 제거 |
| `.env.local` | `IMALYTIX_ENABLE_DINO`, `IMALYTIX_DINO_SERVICE_URL` 제거 |
| `.gitignore` | `ml/` 관련 규칙 제거 |

### 3) `supabase/schema.sql`

- `create extension if not exists vector;` 제거(확장 자체는 남겨둠 — 다른 용도로 이미 켜져 있을 수 있어 명시적 DROP은 안 함)
- `request_images.embedding` 컬럼, HNSW 인덱스, `find_similar_by_embedding` 함수 삭제 (이미 만들어둔 환경을 위한 `DROP`/`ALTER ... DROP COLUMN IF EXISTS` 포함 — 없는 환경에선 no-op)
- `ai_provider_calls.provider`, `verification_evidence.source` CHECK 제약에서 `'dino'` 제거 (기존 제약 `DROP CONSTRAINT IF EXISTS` 후 재생성)
- `client_id`, `feedback.ip`/`user_agent` 컬럼 보강 ALTER 추가 (위 "발견한 것" 표 참고)

## 검증

- `npx tsc --noEmit`, `npx eslint app lib components types`, `npm run build`, `node --check extensions/chrome/sidepanel.js` 전부 클린
- 라이브 서버로 `/api/analyze/image` 실제 이미지 분석 요청 → 200 정상 (DINO 없이 3-LLM+메타데이터만으로 정상 동작 확인)
- DB 기록은 위 "지금 바로 하셔야 하는 것 1)" 해결 전까지 계속 실패합니다(분석 자체엔 영향 없음 — best-effort 설계가 의도대로 동작 중인 것)

## 이번에 다루지 않은 것

- `SUPABASE_SERVICE_ROLE_KEY` 교체는 사용자 액션이 필요해서 대기 중 (위 참고)
- `ai_provider_calls`/`verification_evidence`의 `'dino'` CHECK 제거는 스키마 레벨만 — 만약 이미 `provider='dino'`인 과거 행이 있다면(신규 프로젝트라 없을 가능성 높음) 그 행들은 그대로 남아있고 지우지 않았습니다.
