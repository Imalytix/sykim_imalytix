# 26-08-08 배포 기록 — Gemini 워터마크·C2PA 탐지·스코어링 조정·업로드 에러 수정

개발자 트래킹용 진행 경과 기록. 이번 라운드에서 작업한 내용, 배포 방법과 결과를 정리한다.

## 요약

- **Gemini 생성 워터마크 탐지**: 3개 비전 프로바이더 프롬프트에 "다이아몬드/별 모양 워터마크 발견 시 무조건 AI 판정" 지시 추가
- **C2PA 실제 감지 구현**: 기존 하드코딩 `false`를 JPEG APP11(JUMBF)/PNG `caBX` 청크 존재 여부 감지로 교체
- **스코어링 두 차례 조정**: (1) 단일 모델의 강한 AI 신호가 평균에 묻히지 않도록 블렌딩 추가 → (2) 반대로 여러 보정이 겹쳐 개별 점수(20~30%대)가 최종 0점까지 떨어지던 과도한 극단화 완화
- **바운딩 박스 클릭 시 의심 근거 설명 표시** (과거 있었던 기능 복원)
- **로딩 화면**: 배경 크로마키 처리, 아이콘 확대, 그리고 `display:none`으로 인해 정지해 보이던 버그 수정
- **업로드 실패 버그 수정**: Vercel 함수의 4.5MB 요청 본문 하드 리밋 때문에 발생하던 파싱 에러 수정
- **(코드 외) Supabase Auth URL Configuration 수정**: Site URL이 죽은 옛 Vercel 도메인을 가리키고 있던 것을 실제 도메인(`www.imalytix.com`)으로 교체, Redirect URLs에 `/auth/callback` 경로가 안 걸려있던 것을 와일드카드로 수정

3개 커밋으로 나눠 `research/dino` → `main` 순서로 배포 완료.

---

## 배포 방법

이 프로젝트의 배포 흐름은 다음과 같다 (Vercel의 Production Branch가 `main`으로 설정되어 있어, `main`에 push되는 순간 Vercel이 자동으로 빌드·배포를 시작함):

```bash
# 1. research/dino에서 자유롭게 개발 + 커밋
git add <변경 파일>
git commit -m "..."
git push origin research/dino

# 2. main이 그 사이 다른 커밋으로 갈라지지 않았는지 확인
git fetch origin main
git log --oneline main..origin/main   # 비어있어야 fast-forward 가능

# 3. main으로 fast-forward 병합 (진짜 충돌 없는 한 항상 이 방식)
git checkout main
git merge --ff-only origin/main
git merge --ff-only research/dino
git push origin main                  # ← 이 push가 Vercel 배포를 트리거함

# 4. 다시 개발 브랜치로 복귀
git checkout research/dino
```

배포 전 로컬에서 항상 3가지를 확인:
```bash
npx tsc --noEmit        # 타입 체크
npx eslint <변경 파일>   # 린트
npm run build            # 프로덕션 빌드
```
그리고 실제 로컬 서버(`npm run dev`)에 살아있는 3개 AI 프로바이더 API로 라이브 테스트 1회 이상 실행.

---

## 배포 결과

| 커밋 | 내용 |
|---|---|
| `81c0b69` | Gemini 워터마크 탐지, C2PA 탐지, 강한 단일 AI 신호 블렌딩, 바운딩박스 클릭 설명, 로딩 화면 확대/크로마키 |
| `f41f4e3` | 로딩 아이콘 정지 버그, 스코어링 과도한 극단화 완화 |
| `9766bb5` | 업로드 크기 제한 & JSON 파싱 에러 수정 |

- `main` 브랜치에 fast-forward로 정상 병합, `push origin main` 완료 → Vercel 자동 배포 트리거됨
- 배포 전 매 라운드마다 `tsc`/`eslint`/`npm run build` 클린 확인
- 최종 배포 직전 라이브 테스트(`test-data/images/fake-camera-exif.jpg`, 실제 카메라 EXIF 포함 파일)로 `/api/analyze/image` 정상 호출 확인:
  - HTTP 200, 3개 프로바이더 전부 `is_mock: false`(모의 응답 아님, 실제 판정)
  - `exif_found: true` / `c2pa_found: false` — 실제 파일 특성과 일치
  - 최종 점수 8/100 — 실제 카메라 사진에 적절히 낮은 점수
- Vercel 대시보드에서의 최종 빌드 상태는 별도 확인 필요 (이 세션에는 Vercel CLI/대시보드 접근 권한이 없음)

---

## 수정사항 상세

### 1. Gemini 생성 워터마크 탐지 (`lib/vision/prompts.ts`)

Google Gemini(Nano Banana/Imagen) 이미지 생성 도구가 결과물에 남기는 작은 다이아몬드/별 모양 반짝이는 워터마크를 3개 비전 프로바이더(OpenAI/Gemini/Claude) 프롬프트 공통 체크리스트(`CONTENT_CLASSIFIER`) 맨 앞에 최우선 확인 항목으로 추가. 발견 시 다른 판정 기준과 무관하게 `is_ai_generated: true`, `score 0.97+`, `confidence: "high"`로 강제.

- 순수 프롬프트 엔지니어링(기존 비전 LLM 호출 인프라 재사용) — 별도 이미지 매칭/CV 코드 추가 없음
- `QUICK_PROMPT`/`ILLUSTRATION_PROMPT`에도 동일 지시 추가
- 한계: 워터마크를 실제로 놓치지 않고 인식할지는 LLM 성능에 달려있어 100% 보장은 아님 — 추가 테스트 권장

### 2. C2PA 실제 감지 구현 (`lib/analysis/metadata.ts`)

기존에 `c2pa_found`가 항상 `false`로 하드코딩되어 있던 것을 실제 감지 로직으로 교체:
- **JPEG**: APP11(0xFFEB) 마커 세그먼트가 "JP" Common Identifier로 시작하는지 검사 (ISO/IEC 19566-5 JUMBF 스펙 — C2PA의 실제 JPEG 임베딩 방식)
- **PNG**: `caBX` 청크(C2PA PNG 임베딩 스펙에 정의된 전용 청크) 존재 여부 검사
- 네이티브 의존성 없는 순수 JS 바이트 파싱. 존재 여부만 확인하고 서명 자체의 암호학적 유효성 검증은 하지 않음(EXIF/PNG 메타데이터 감지와 동일한 한계)
- 검증: C2PA 공식 conformance 테스트셋(`c2pa-org/public-testfiles`)의 `truepic-20230212-camera.jpg`(C2PA+EXIF 둘 다 포함)로 실사용 확인 — `c2pa_found: true` 정상 반영

### 3. Aggregator 스코어링 조정 (`lib/analysis/aggregator.ts`)

두 차례에 걸쳐 조정:

**(1) 강한 단일 AI 신호 반영** — 3개 모델 중 1개만 확신에 찬 AI 판정(`score ≥ 0.8`, confidence medium/high)을 내려도 나머지 2개의 애매한 판정에 묻히지 않도록, 평균과 그 강한 신호를 50:50 블렌딩. 해당 신호가 있으면 "다수결 실제 판정" 페널티도 스킵.

**(2) 과도한 극단화 완화** — (1)과는 별개로, "모델 합의 보너스"(2개 이상 같은 방향으로 판정 시 가감점)와 "시각 근거 보너스/페널티"(evidence severity 합산, 최대 ±25점)가 둘 다 각 모델이 이미 자기 score에 반영한 판단을 한 번 더 가산/감산하는 구조였음 — 그래서 3개 모델이 전부 20~30%대(애매하게 실제 쪽)로만 나와도 두 보정이 겹쳐 최종 점수가 0까지 떨어지는 사례 발생(실사용 피드백으로 확인). 보정폭을 줄임: 합의 보너스/페널티 `±10/-8` → `±4/-3`, 시각 근거 캡 `±25` → `±10`.

수치 검증(스크립트로 재현):
| 시나리오 | 수정 전 | 수정 후 |
|---|---|---|
| 22%/20%/30%(전부 실제 판정, 실사용 재현 케이스) | **0점** | **3점** |
| 강한 단일 AI 신호 케이스 | 정상 작동 | 정상 작동 유지 |
| 압도적 real 케이스(전부 5~10%대, 강한 증거) | 0점 | 0점 (정당한 극단값은 그대로 유지) |

### 4. 바운딩 박스 클릭 → 의심 근거 설명 (`components/results/AnalysisResultView.tsx`)

과거 있었다가 리디자인 과정에서 빠진 기능 복원. 박스를 `<button>`으로 변경해 클릭 가능하게 하고, 선택 시 하이라이트 + 이미지 아래 카드에 해당 영역의 `label`/위험도 배지(낮음·보통·높음)/`description`(의심 근거) 표시. 백엔드 데이터는 이미 있던 필드라 UI만 연결.

동시에 바운딩 박스 색상을 빨강 → 브랜드 블루(`#52bdff`)로 변경, 모서리 핸들 추가, 이미지 가장자리에 붙는 박스의 핸들이 `overflow-hidden`에 잘리던 문제 수정(오버레이 레이어 분리).

### 5. 로딩 화면 (`components/results/AnalysisStepsLoader.tsx`)

- **배경 제거(크로마키)**: `loading.mp4`의 배경색이 페이지 순수 검정과 달라 사각형 틀이 도드라져 보이던 문제 — 캔버스에 매 프레임 그려서 첫 프레임 모서리 색을 배경색으로 자동 샘플링, 그 색과 가까운 픽셀을 투명 처리
- **아이콘 확대**: 배경이 아닌 픽셀(아이콘)의 바운딩 박스를 자동으로 찾아 그 부분만 크롭해서 그리는 방식으로, 컨테이너를 키운 만큼 아이콘도 그대로 커지게 함
- **정지 아이콘 버그 수정**: `<video>`에 Tailwind `hidden`(`display:none`)을 줬던 게 원인 — 브라우저가 화면에 없는 video의 프레임 디코딩을 멈춰버려 캔버스가 첫 프레임에서 정지해 보였음. `display:none` 대신 레이아웃엔 있되 화면엔 안 보이는 방식(`position:absolute`, 1px×1px, `opacity:0`)으로 교체해 계속 디코딩되게 함

### 6. 업로드 실패 버그 수정 — "Unexpected token 'R'..." 에러 (`app/page.tsx`, `app/api/analyze/image/route.ts`, `components/upload/ImageUploader.tsx`)

**원인**: Vercel 서버리스 함수는 요청/응답 본문을 4.5MB로 하드 제한하는데(플랜 무관, [공식 문서](https://vercel.com/docs/functions/limitations#request-body-size)), 앱 자체 업로드 제한은 10MB였음. 그래서 4.5MB~10MB 사이 파일(고해상도 PNG 등에서 흔함)은:
1. 우리 라우트 코드가 실행되기도 전에 Vercel 플랫폼이 요청을 끊고 JSON이 아닌 응답(`Request Entity Too Large`)을 반환
2. 클라이언트가 그 응답을 무조건 JSON으로 가정하고 `response.json()`을 호출 → `SyntaxError`가 그대로 사용자에게 원문 노출됨

**수정**:
- 업로드 허용 크기를 Vercel 한도보다 안전하게 낮은 **4MB**로 하향 (클라이언트/서버 동일하게)
- 클라이언트의 `response.json()` 호출을 안전 처리(`.catch(() => null)`) — 비-JSON 응답이 와도 정상적인 한국어 에러 메시지로 폴백, `413` 상태 코드는 별도로 명확한 메시지 표시

**남은 리스크**: 응답 쪽도 동일한 4.5MB 한도를 받는데, 지금 응답에 분석 이미지 전체를 base64로(`analyzed_image_data_url`) 돌려주고 있어 고해상도 이미지 + provider raw 응답이 합쳐지면 이론상 응답 크기로도 한도에 걸릴 수 있음. 아직 재현된 적은 없어 손대지 않았으나, "업로드는 성공했는데 결과 화면 단계에서" 비슷한 에러가 나면 이게 원인일 가능성이 높음.

### 7. (코드 외) Supabase Auth URL Configuration 수정

로그인 시 `sykimimalytix.vercel.app`(더 이상 살아있지 않은 옛 Vercel 배포 도메인)로 리다이렉트되며 `404 DEPLOYMENT_NOT_FOUND`가 발생하던 문제. 원인은 Supabase Dashboard → Authentication → URL Configuration:
- **Site URL**이 옛 도메인으로 설정되어 있었음 → `https://www.imalytix.com/`로 교체
- **Redirect URLs**에 `https://www.imalytix.com/`(루트만) 등록되어 있어 우리 앱이 요청하는 `/auth/callback` 경로가 허용 목록에 안 걸림 → `https://www.imalytix.com/**` 와일드카드로 교체

Supabase는 앱이 요청한 `redirectTo`가 허용 목록에 없으면 조용히 Site URL로 폴백하는데, 이게 정확히 관찰된 증상(엉뚱한 도메인 + 경로 없이 루트로 리다이렉트)과 일치했음.

---

## 알려진 이슈 / 후속 확인 필요

- **메타데이터 "동일한 결과 반복" 피드백** — 코드 상으로 원인 재현/특정 실패 (서버리스 전역 상태 누수, 응답 캐싱, 리사이즈된 이미지에서 메타데이터를 읽는 버그 등 의심 지점을 확인했으나 전부 정상). 어떤 이미지들로 테스트했을 때 정확히 무엇이 반복됐는지 구체적인 사례 필요
- **feedback 테이블 분석** — 이 세션에서 Supabase DB에 직접 쿼리할 수 있는 도구가 없어 미완료. 대시보드에서 직접 확인하거나 SQL 결과를 공유받아야 진행 가능
- **응답 본문 4.5MB 한도** — 위 6번 항목의 "남은 리스크" 참고, 아직 코드 수정 안 함
