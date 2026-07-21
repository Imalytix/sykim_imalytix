# Imalytix 개발 진척도 — Module A/B (AI 생성 판별 + 도용 탐지)

> 대상 지시서: `Imalytix 개발지시서 v2` (2026-07-19, v2.1)
> 이 문서는 지시서의 체크리스트(5절)를 실제 코드 작업 진행에 맞춰 계속 업데이트합니다.
> **작업 위치**: 이 저장소(`imalytix-nextjs`)에 `ml/` 디렉터리를 새로 만들어 Python ML 파이프라인을 둡니다 — Next.js(TypeScript) 웹앱과는 완전히 별도 런타임이며, Next.js가 이 코드를 직접 실행하지 않습니다 (학습은 오프라인/로컬 GPU에서, 산출물인 `linear_probe.joblib`만 나중에 서비스에 연결).

---

## 상태 요약 (한눈에 보기)

| # | 항목 | 상태 | 비고 |
|---|---|---|---|
| 1 | DINOv3 접근 신청 | 🟢 완료 | `dinov3_vits16_pretrain_lvd1689m` 체크포인트(.pth) 확보, 연결·스모크테스트·실제 임베딩 추출까지 검증 완료 (2026-07-21) |
| 2 | DINOv2/v3 기반 모듈 A 파이프라인 골격 | 🟢 완료 | DINOv2(HF)/DINOv3(torch.hub+로컬 체크포인트) 둘 다 지원, 실사용 검증됨 |
| 3 | 데이터 수집 (이종 생성기 × 4개 카테고리) | 🟡 1차 완료, 확장 필요 | real 605장(Unsplash Lite) + ai_generated 600장(DiffusionDB, SD only) 확보·검증 완료. **생성기가 SD 1종뿐** — FLUX/팀도구(Midjourney 등) 추가 투입 필요 (지시서 "2~3종 이상" 요구사항) |
| 4 | linear probe 1차 학습 | 🟢 완료 (2026-07-21) | 전체 정확도 95%, 카테고리별 91.7~97.2% — 아래 "1차 학습 결과" 참고. **SD 1종 데이터만으로 나온 수치라 낙관적일 수 있음**, 생성기 다양화 후 재학습 필요 |
| 5 | pHash 임계값 실데이터 재보정 | ⚪ 미착수 | 마켓 실제 사진 샘플 필요 |
| 6 | pgvector 스키마 + K 스윕 | 🟡 부분 완료 | Supabase 프로젝트 생성 완료, `images` 테이블 + pHash Hamming distance 검색(`find_similar_images`) 구현·실사용 테스트 완료. **embedding(pgvector) 컬럼은 자리만 만들어둠 — DINO 임베딩 kNN 연동은 미착수** |
| 7 | Google Vision API 키 발급 | 🔴 **보류 (사용자 지시)** | 발급 방법만 안내, 실제 키 발급/연동은 사용자가 먼저 진행하기 전까지 미착수 |
| 8 | 3단계 파이프라인 오케스트레이션 (pHash→pgvector→Vision) | 🟡 1/3 완료 | pHash 단계만 구현·연동됨 (`lib/db/imageRecords.ts` → `lib/analysis/pipeline.ts`). pgvector·Vision 단계는 미착수 |
| 9 | LLM 연동 | 🟢 결정 완료 — 기존 구조 유지 | LLM은 판정 모듈로 계속 사용, DINO는 추가 신호로 병행 예정 (아래 참고) |
| 10 | 모듈 A 성능 벤치마크 | 🟡 1차 수치 나옴 | 4번 항목 참고. 생성기 다양화 전이라 정식 벤치마크로 보기엔 이름 |

🔴 승인 게이트(정지 중) · 🟠 결정 필요(정지 중) · 🟡 진행 중 · 🟢 완료 · ⚪ 미착수

---

## 세션 2 (2026-07-20~21) 진행 내용

### 🟢 데이터 수집 완료 — real 605장 + ai_generated 600장

- **real**: `build_dataset_from_unsplash_lite.py` 실행 완료. 과정에서 URL 파라미터 버그(`&w=1080` → `?w=1080`, base URL에 기존 쿼리스트링이 없어 404 발생하던 문제) 발견·수정. person 155장(테스트 5장 포함) / building·misc·item 각 150장, 총 605장. 0바이트/손상 파일 없음 검증 완료.
- **ai_generated**: `build_dataset_from_diffusiondb.py` 실행. `datasets` 라이브러리 버전 호환성 문제 3연속 발생 → 해결 과정: ① `datasets>=4.0`에서 스크립트 기반 로더 완전 제거("Dataset scripts are no longer supported") → ② parquet 자동변환 fallback 시도했으나 config가 `default`로 뭉개져서 원하는 서브셋(`2m_random_50k`) 지정 불가 → ③ `datasets==2.21.0`으로 다운그레이드(레거시 로더 복원) + `trust_remote_code=True` 추가로 최종 해결. 카테고리당 150장(NSFW 필터로 person 34개/building 11개/misc 5개/item 19개 스킵), 총 600장.
- **주의**: ai_generated는 **전부 Stable Diffusion**(DiffusionDB 특성상) — 지시서가 요구하는 "이종 생성기 2~3종 이상"을 아직 충족 못 함. FLUX.1-schnell + 팀 도구(Midjourney) 투입 필요 (아래 참고).

### 🟢 DINOv3 연결 — 스모크테스트 + 실제 추출까지 검증 완료

사용자가 `dinov3_vits16_pretrain_lvd1689m-08c60483.pth`(86.5MB)를 `ml/checkpoints/`에 배치, `ml/.env`에 `IMALYTIX_BACKBONE_SOURCE=torchhub` 설정 후 실행.

**발견한 이슈**: DINOv3 GitHub 저장소의 `hubconf.py`가 우리가 실제로 쓰는 백본 엔트리포인트(`dinov3_vits16`)와 무관하게 세그멘테이션/평가용 엔트리포인트까지 **모듈 최상단에서 전부 import**해서, `torchmetrics`·`termcolor` 같은 무관한 패키지가 없으면 import 단계에서 죽음. `pip install torchmetrics termcolor`로 해결하고 `requirements.txt`에 주석과 함께 추가해둠. 또한 `backbone.py`가 `ml/.env`를 자동으로 읽지 않던 버그도 발견 — `load_dotenv()` 호출 추가.

스모크 테스트(임베딩 차원 384, shape 정상) → 전체 1,205장 배치 추출까지 GPU에서 정상 동작 확인.

### 🟢 linear probe 1차 학습 결과 (2026-07-21)

```
전체 검증 정확도: 95% (n=241)
  building    n=60   accuracy=0.917
  item        n=52   accuracy=0.962
  misc        n=57   accuracy=0.947
  person      n=72   accuracy=0.972
```

카테고리별 편차가 크지 않고(91.7~97.2%), 걱정했던 person 카테고리(데이터 상대적으로 적을 것으로 예상)도 오히려 가장 높게 나옴. **다만 이 수치는 ai_generated가 전부 Stable Diffusion 한 생성기뿐이라 나온 낙관적인 결과일 가능성이 큼** — FLUX/Midjourney 등 다른 생성기를 섞으면 정확도가 떨어질 걸로 예상하는 게 안전하며, 그게 이 수치의 진짜 의미를 확인하는 다음 단계.

### 🟢 Module B 1단계 — pHash 동일/유사 이미지 탐지 구현·연동·실사용 테스트 완료

- `supabase/schema.sql` — `images` 테이블(`phash bit(64)` + 나중에 쓸 `embedding vector(384)` 자리) + `find_similar_images`/`insert_image_record` RPC 함수.
- **삽질 기록**: 처음에 hex→bit 변환을 `decode(hex,'hex')::bit(64)`로 SQL에서 처리하려다 `ERROR 42846: cannot cast type bytea to bit` — Postgres에 그 캐스트가 아예 없음. TypeScript 쪽(`hexToBitString()`)에서 64자리 `'0'/'1'` 문자열로 미리 변환해서 넘기고 SQL은 `'1010...'::bit(64)`로 캐스트하는 방식으로 수정, 정상 동작 확인.
- `lib/supabase/client.ts`, `lib/db/imageRecords.ts` 작성, `lib/analysis/pipeline.ts`에 연동 (매 분석마다 기존 DB와 pHash 비교 → `duplicate_check` 필드로 응답 포함, 분석 후 자기 자신도 DB에 기록).
- 실제 요청 3건으로 검증: 기존 이미지 재분석 시 매치됨(distance=0), 같은 이미지 반복 시 매치 누적, 다른 이미지는 매치 0건(오탐 없음).
- `.env.local` 변수명 정리: `TURSO_DATABASE_URL`/`anon_public_key`/`service_role_key`(예전 Turso 검토 시절 잔재, 실제 값은 Supabase) → `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`.

### 🟢 마케팅팀용 AI 이미지 생성 요청서 작성

`ml/AI_이미지_생성_요청서.md` — Midjourney로 카테고리별 40~80장 생성 요청 지시문 (전달 방법/기한은 빈칸으로 남겨둠, 사용자가 채워서 전달).

---

## 세션 1 (2026-07-19) 진행 내용

### ✅ 진척도 문서 작성 (이 파일)
지시서 5절 체크리스트를 추적 가능한 형태로 옮김. 앞으로 이 문서를 계속 갱신.

### 🟢 Module A — `ml/` 파이프라인 스캐폴딩 완료
지시서 2.3절의 검증된 코드(임베딩 추출 → linear probe 학습 → 추론)를 실행 가능한 스크립트로 정리 완료.

```
ml/
├── requirements.txt          # torch, torchvision, transformers, scikit-learn 등
├── backbone.py                # 임베딩 추출 함수 — HF(DINOv2) / torch.hub(DINOv3) 둘 다 지원
├── DINOV3_SETUP.md            # DINOv3 .pth 체크포인트 연결 가이드 (개념 설명 + 트러블슈팅)
├── checkpoints/                # DINOv3 등 gated 체크포인트 두는 곳 (gitignore, 각자 로컬에만)
├── extract_embeddings.py      # Step 1 — 데이터 폴더 순회 -> embeddings.npy (GPU 필요)
├── train_linear_probe.py      # Step 2 — 로지스틱회귀 학습 + 카테고리별 정확도 리포트 (CPU)
├── infer.py                   # Step 3 — 신규 이미지 1장 추론
├── build_dataset_from_unsplash_lite.py    # real/ 자동 수집 (Unsplash Lite, CC0급 상업 허용)
├── build_dataset_from_diffusiondb.py      # ai_generated/ 자동 수집 (DiffusionDB, CC0, SD only)
├── data/<category>/{real,ai_generated}/   # 카테고리 4종 폴더 뼈대만 생성 (이미지는 gitignore)
└── artifacts/                 # embeddings.npy, linear_probe.joblib 등 산출물
```

### 🟢 DINOv3 연결 완료 (2026-07-19)
사용자가 Meta 승인 절차를 직접 완료하고 `dinov3_vits16_pretrain_lvd1689m-08c60483.pth` 체크포인트를 확보함. DINOv2(HF 포맷)와 DINOv3(raw `.pth`)는 로딩 방식이 근본적으로 달라서(HF는 구조+가중치 세트 배포, raw 체크포인트는 구조는 GitHub 공개 코드에서 별도로 받아와 가중치만 로컬 파일로 결합) `backbone.py`를 두 백본 소스를 모두 지원하도록 확장. `.env`의 `IMALYTIX_BACKBONE_SOURCE=torchhub` 설정 3줄로 전환 가능.

**⚠️ 미검증**: 이 연결 코드는 GPU/인터넷/gated 파일이 모두 필요해서 개발 세션에서 직접 실행 테스트는 못 함 (DINOv2/DINOv3 공개 사용 관례 기반으로 최대한 정확하게 작성). `ml/DINOV3_SETUP.md`의 5절 스모크 테스트로 사용자가 직접 1회 검증 필요.

### 🟡 데이터 수집 — 소스 결정 + 컴플라이언스 이슈 발견/수정

- **`real/` (실사)**: 처음엔 Unsplash **검색 API**로 자동 수집하려 했으나(`ml/download_real_images.py`), **Unsplash API 약관 12조가 검색 API로 받은 콘텐츠의 ML 학습 사용을 금지**하고 있다는 걸 확인함 — ML 용도는 별도 Dataset 상품(unsplash.com/data)을 쓰라고 명시. 그래서 **Unsplash Lite Dataset**(무료 2.5만 장, 상업적 ML 학습 명시적 허용) 기반으로 전환. `ml/build_dataset_from_unsplash_lite.py` 작성 완료 — 로컬에 다운로드한 Lite 데이터셋 TSV를 카테고리 키워드로 필터링해서 이미지 저장.
  - ⚠️ **Full 데이터셋(480만 장, 승인 필요)은 절대 쓰면 안 됨** — 비상업적 전용 라이선스라 그걸로 학습한 모델은 상업 서비스에 쓸 수 없음. Lite만 사용.
  - 기존 `download_real_images.py`는 스크립트로 남겨두되 상단에 "학습 데이터로 쓰지 말 것" 경고 추가.
- **`ai_generated/` (AI 생성)**: 원래는 팀 수동 생성만 계획했으나, **DiffusionDB**(Stable Diffusion 실사용자 프롬프트 기반, **CC0 완전 무료·상업적 이용 명시적 허용**)를 찾아서 `ml/build_dataset_from_diffusiondb.py` 작성 완료 — 카테고리 키워드로 필터링 + NSFW 자동 스킵. SD 하나뿐이라 **FLUX.1-schnell(Apache 2.0, 무료 Spaces로 수동 생성)** + **팀 보유 도구(Midjourney 등, 수동)**를 반드시 같이 섞어야 함(개발지시서의 "2~3종 이상 생성기" 요구사항).
  - ⚠️ **GenImage, JourneyDB는 검토 후 제외** — Midjourney 이미지 포함해서 다양성은 좋지만 라이선스 조항이 불명확/커스텀이라 상업 서비스에 쓰기엔 리스크 있다고 판단. 나중에 직접 약관 재검토해서 안전하면 추가 가능.

**다음 필요한 것**:
1. ~~Unsplash Lite Dataset 다운로드~~ — ✅ 사용자가 완료함(`unsplash-research-dataset-lite-latest/` 폴더에 위치, `.gitignore`에 반영 완료)
2. `python build_dataset_from_unsplash_lite.py --dataset-dir ./unsplash-research-dataset-lite-latest` 실행 (real 이미지 채우기)
3. `python build_dataset_from_diffusiondb.py` 실행 (ai_generated 1차: Stable Diffusion)
4. FLUX.1-schnell(무료 HF Spaces) + 팀 보유 도구로 ai_generated 나머지 채우기

---

## 🔴 승인 게이트 (지시서 6절 그대로 유지 — 절대 진행 안 함)

아래 항목은 지시서에 명시된 대로 **Claude Code가 사용자 승인 없이 진행하지 않습니다.**

- [x] ~~**DINOv3 접근 신청**~~ — 사용자가 직접 완료, 체크포인트 확보 (2026-07-19)
- [ ] **사용자 업로드 이미지 → 학습 데이터 전환** — 개인정보/약관 이슈, `storage/uploads/`에 쌓인 기존 이미지를 학습에 쓰려면 별도 승인 필요
- [ ] **Google Vision API 키 발급 및 유료 사용 시작** — 건당 $3.50/1,000건, 실제 비용 발생 결정

---

## 🟠 열린 질문 — 진행 전 결정이 필요합니다

### 1. Module B 저장소 — ✅ 결정 완료 (2026-07-19)

**결정: PostgreSQL + pgvector.** Turso(SQLite)는 벡터 인덱스가 없어 코사인 유사도를 애플리케이션 레벨 전수 계산해야 하는데, 이건 데이터가 쌓일수록 확장이 안 됨. pgvector의 HNSW 인덱스가 이 문제를 정확히 해결하는 도구라 채택.

호스팅은 **Supabase 추천으로 최종 정리** — Neon도 검토했으나, Supabase는 pgvector DB뿐 아니라 **파일 스토리지(Storage)도 같이 제공**해서 이전에 논의했던 "Vercel 배포하면 이미지가 사라지는 문제"(서버리스 파일시스템 휘발성)까지 한 서비스로 같이 해결됨. Neon만 쓰면 DB는 되지만 이미지 저장소는 여전히 S3/R2 등을 별도로 구해야 함. 계정 생성 단계는 무료지만, 실제 프로젝트 생성/연결 문자열 발급은 사용자가 직접 진행(가입 절차 필요).

**다음 필요한 것**: Supabase 프로젝트 생성 (사용자 진행) → `DATABASE_URL` 연결 문자열 전달 → 스키마·연동 코드 작성.

### 2. LLM의 역할 — ✅ 결정 완료 (2026-07-19)

**결정: LLM은 판정 모듈로 계속 유지.** 지시서 원문의 "LLM은 설명기일 뿐" 원칙 대신, **DINO(모듈 A)가 기대만큼 성능이 안 나올 가능성에 대비해 LLM 3종도 계속 분석 모듈로 병행**하기로 확정. 즉 기존 `lib/analysis/aggregator.ts`의 3-LLM 판정 구조는 그대로 유지하고, Module A 학습이 끝나면 **네 번째 신호로 추가**한다 (걷어내지 않음).

옛 Python 프로젝트의 `vision_results`(LLM) / `detector_results`(전용 탐지기) 분리 패턴을 되살려서, DINO 점수를 `detector_results` 성격의 별도 신호로 aggregator에 합산하는 방향. 실제 연동 코드는 Module A 학습이 완료되어 `linear_probe.joblib`이 나온 뒤에 작성.

### 3. `ml/` 코드의 최종 실행 위치

로컬 노트북(RTX PRO 500 6GB)에서 학습을 돌린다는 전제인데, 이 학습 스크립트를 **이 저장소(`imalytix-nextjs`) 안에 같이 둘지, 별도 저장소로 분리할지** 확인 부탁드립니다. 우선 이 저장소 안 `ml/`에 스캐폴딩해두고, 필요하면 나중에 분리하는 쪽으로 진행하겠습니다 (되돌리기 쉬운 선택).

---

## 다음 세션에서 이어갈 것

- [ ] **FLUX.1-schnell + 팀 도구(Midjourney) 이미지 확보** — 지금 linear probe 95%는 SD 단일 생성기 데이터라 낙관적일 가능성 큼. `ml/AI_이미지_생성_요청서.md`를 마케팅팀에 전달(전달 방법/기한 빈칸 채워서), FLUX는 HF Spaces 무료 데모로 직접 생성 가능
- [ ] 생성기 다양화 후 `python extract_embeddings.py` → `python train_linear_probe.py` **재학습** — 정확도가 떨어지는지, 어느 카테고리가 특히 취약한지 확인이 진짜 목적
- [ ] pgvector kNN 연동 — `images.embedding` 컬럼은 만들어뒀지만 실제로 DINO 임베딩을 채워넣고 코사인 유사도로 검색하는 코드는 미착수 (지금은 pHash Hamming distance만 동작)
- [ ] `aggregator.ts`에 DINO(linear probe) 점수를 4번째 신호로 합산하는 코드 — `linear_probe.joblib`은 이제 나왔으니 Next.js에서 어떻게 호출할지 결정 필요 (Python 서브프로세스 vs ONNX 변환 후 JS 추론 vs 별도 Python 마이크로서비스)
- [ ] pHash 임계값 재보정용 실측 스크립트 준비 (실제 마켓 이미지 샘플 확보되는 대로)
- [ ] Google Vision API — 사용자가 보류 지시, 재개 시점 확인 필요
- [ ] `ml/` 저장소 분리 여부 최종 확인 (열린 질문 3번 — 아직 미확정, 우선 이 저장소 안에서 진행 중)
