# Module A — DINOv2 frozen backbone + linear probe

AI 생성 이미지 판별기. `개발지시서 v2` 2절 참고. **Next.js 앱과 별도 런타임**입니다 —
여기 스크립트는 Next.js가 실행하지 않고, 학습 산출물(`linear_probe.joblib`)만
나중에 서비스에 연결합니다.

## DINOv2 vs DINOv3

기본값은 **DINOv2**(Apache 2.0, 즉시 사용 가능)입니다. **DINOv3 체크포인트를
받으셨다면 `ml/DINOV3_SETUP.md`를 따라 `.env`에 3줄만 추가하면 스왑됩니다**
— HF 포맷(DINOv2)과 raw 체크포인트 포맷(DINOv3)이 로딩 방식 자체가 달라서
`backbone.py`가 둘 다 지원하도록 만들어뒀습니다. 그 문서에 "왜 두 방식이
다른지"부터 스모크 테스트까지 정리되어 있습니다.

## 실행 환경

- **GPU 필요한 단계**: `extract_embeddings.py` (백본 forward pass)만. 로컬 노트북
  (RTX PRO 500 6GB) 또는 Colab에서 실행.
- **CPU만으로 충분한 단계**: `train_linear_probe.py`, `infer.py`. 파라미터 수백 개
  짜리 로지스틱 회귀라 수천 장 기준 CPU로 수 분 내 학습됩니다.

```bash
cd ml
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## 데이터 준비

`ml/data/<카테고리>/<real|ai_generated>/` 구조로 이미지를 채웁니다.
카테고리 4종은 실사용 도메인 반영(개발지시서 2.2절) — **하나라도 비어 있으면
그 카테고리에서만 정확도가 떨어질 수 있습니다.**

```
ml/data/
  person/{real,ai_generated}/       # 인물 (프로필/전신 — 판매자 인증샷 등)
  building/{real,ai_generated}/     # 건물/실내공간 (인테리어, 건축)
  misc/{real,ai_generated}/         # 잡화/생활용품
  item/{real,ai_generated}/         # 물품 (가방·시계 등 리세일 타깃)
```

이미지 자체는 `.gitignore` 처리되어 있어 저장소에 커밋되지 않습니다 — 각
팀원이 로컬에 직접 채워야 합니다. (단, 아래 `real/` 폴더의 `manifest.csv`는
출처/작가 크레딧 기록이라 커밋 대상입니다.)

### `real/` — Unsplash **Lite Dataset**에서 수집 (⚠️ 검색 API 아님)

**중요**: Unsplash API 약관(Section 12)은 검색 API로 받은 콘텐츠를 "machine
learning and/or artificial intelligence purposes"에 쓰는 걸 금지하고, ML
용도는 별도의 Dataset 상품을 쓰라고 명시합니다. 그래서 실시간 검색 API
(`download_real_images.py`)가 아니라 **Unsplash Lite Dataset**(무료, 상업적
ML 학습 명시적으로 허용)을 씁니다.

```bash
# 1) 브라우저에서 수동 다운로드 (약관 동의 클릭스루라 자동화 불가)
#    https://unsplash.com/data/lite/latest  (~700MB zip)
#    압축 해제 → ml/unsplash-lite/ 에 photos.tsv000, keywords.tsv000 등이 보이면 OK

# 2) 카테고리별 필터링 + 다운로드
python build_dataset_from_unsplash_lite.py --dataset-dir ./unsplash-lite
python build_dataset_from_unsplash_lite.py --dataset-dir ./unsplash-lite --per-category 150
python build_dataset_from_unsplash_lite.py --dataset-dir ./unsplash-lite --category person
```

`keywords.tsv000`에서 카테고리별 키워드(`CATEGORY_KEYWORDS`)로 사진을 찾고,
`photos.tsv000`과 조인해서 이미지를 내려받습니다. 이미 받은 사진은
`manifest.csv`로 추적해서 재실행해도 중복 다운로드하지 않습니다.

**⚠️ Full 데이터셋(480만 장)은 쓰지 마세요.** Full은 승인 신청이 필요하고
**비상업적 전용 라이선스**라, 그걸로 학습한 모델은 상업 서비스(Imalytix)에
쓸 수 없습니다 — Lite(2.5만 장)만 상업적 ML 학습이 명시적으로 허용됩니다.

**도메인 갭 주의**: Unsplash는 "잘 찍힌 사진" 위주라, 실제 중고거래 판매자가
대충 찍은 사진과는 화질/구도 갭이 있을 수 있습니다. 검증 정확도가 실서비스에서
그대로 재현 안 되면 이 도메인 갭을 의심해보세요 (자사 실사용자 이미지를 나중에
섞으려면 `docs/DEV_PROGRESS_MODULE_AB.md`의 승인 게이트를 거쳐야 함).

`download_real_images.py`(실시간 검색 API)는 스크립트로 남아있지만 **학습
데이터 용도로 쓰면 안 됩니다** — 스크립트 상단 경고 참고.

### `ai_generated/` — 3개 소스를 섞어서 채웁니다

**SD 계열 하나만 쓰면 안 됩니다** — 최소 2~3종 이상의 서로 다른 생성기를
섞어야 최신 폐쇄형 생성기(Midjourney v7, GPT-4o 이미지 생성 등)에도
일반화됩니다 (개발지시서 2.2절 "도메인 갭"). 파일명은 자유 —
`extract_embeddings.py`는 폴더 위치만으로 라벨을 판단합니다.

**1) DiffusionDB (자동, 추천) — Stable Diffusion, CC0(완전 무료·상업적 이용 가능)**

```bash
python build_dataset_from_diffusiondb.py                    # 카테고리당 150장
python build_dataset_from_diffusiondb.py --per-category 300
```

실제 사용자가 입력한 프롬프트로 생성된 SD 이미지 1,400만 장 중 카테고리
키워드로 매칭되는 것만 골라 다운로드합니다. NSFW 점수가 높은 이미지는
자동으로 건너뜁니다. **이것만으로는 부족합니다** — SD 하나뿐이라 아래 2, 3과
반드시 섞으세요.

**2) FLUX.1-schnell (수동) — Diffusion Transformer 계열, Apache 2.0(상업적 이용 명시적 허용)**

Hugging Face의 무료 Spaces 데모(검색: "FLUX.1-schnell") 또는 로컬
ComfyUI/Diffusers로 생성해서 `ai_generated/` 각 카테고리 폴더에 직접
넣어주세요. SD와 아키텍처가 달라(디퓨전 트랜스포머) 의미 있는 다양성을
추가해줍니다.

**3) 팀 보유 도구 (수동) — Midjourney 등**

Midjourney 구독 등 팀이 이미 갖고 있는 도구로 직접 생성해서 채워주세요.

**검토했지만 추천하지 않는 소스**: GenImage(Midjourney 포함 7종 생성기라
매력적이지만 라이선스 조항이 명확히 공개돼 있지 않음), JourneyDB(Midjourney
440만 장, "customised Terms of Usage"로 상업적 이용 가능 여부 불명확) — 둘
다 상업 서비스에 쓰기엔 라이선스 리스크가 있어서 뺐습니다. 나중에 직접
약관을 검토해서 안전하다고 판단되면 추가해도 됩니다.

## 실행 순서

```bash
python extract_embeddings.py    # 1) 임베딩 추출 (GPU) -> artifacts/*.npy
python train_linear_probe.py    # 2) linear probe 학습 (CPU) -> artifacts/linear_probe.joblib
python infer.py path/to/new.jpg # 3) 추론
```

`train_linear_probe.py`는 전체 검증 정확도뿐 아니라 **카테고리별 정확도도 따로
출력**합니다 — 특정 카테고리(예: person)만 유독 낮게 나오면 그 카테고리 데이터를
보강해야 한다는 신호입니다.

## 알려진 한계

이 방식은 **로컬 편집/인페인팅(결함 부위만 지운 사진)에 취약**합니다 (참고 논문
기준 45~65%, 동전던지기 수준). global pooling 특성상 정상 영역 신호가 편집
영역 흔적을 희석시키기 때문입니다. 이건 Imalytix 핵심 가치(결함 은폐 탐지)와
겹치는 약점이라 **이 모듈 단독으로 "결함 은폐 여부"를 판정하지 않습니다** —
그 부분은 Module B(pHash/임베딩 유사도로 원본과 대조)가 커버합니다. 로컬 편집
전용 탐지기(Module C)는 이번 스프린트 스코프 밖이며 로드맵으로 미뤄져 있습니다.
