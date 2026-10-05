# 정확도 측정 데이터셋

`scripts/measure-accuracy.js`가 읽는 폴더입니다. 정답(ground truth)을 **폴더 이름으로** 나타냅니다 — 별도 라벨 파일을 적을 필요가 없습니다.

```
test-data/accuracy-dataset/
├── real/           ← 실제 사진 (팀원이 직접 촬영했거나 출처가 확실한 사진)
└── ai_generated/   ← AI 생성·편집/위조 사진 (Nano Banana, gpt-image-1 등으로 만든 것)
```

- 두 폴더에 jpg/jpeg/png/webp 파일을 그냥 넣으면 됩니다. 파일명은 자유.
- **`real/`에는 정말로 AI가 손대지 않은 사진만 넣으세요** — 조금이라도 편집/보정한 사진은 `ai_generated/`로 가야 정확한 채점이 됩니다.
- 이 폴더 자체는 `.gitignore`에 들어 있어 커밋되지 않습니다 — 팀원 개인 사진이 섞이기 때문에 의도적으로 로컬 전용입니다.
- 전체가 50장을 넘으면 비용 관리를 위해 무작위로 50장만 뽑아 실행합니다(`ACCURACY_SAMPLE_SIZE` 환경변수로 조정 가능).

## 실행

```
npm run dev                 # 다른 터미널에서 로컬 서버 기동
npm run test:accuracy       # 이 폴더 전체를 분석하고 채점
```

운영 서버 기준으로 재보려면:
```
PERF_BASE_URL=https://www.imalytix.com npm run test:accuracy
```

결과는 콘솔 요약 + `test-data/accuracy-report.md`(표) + `test-data/accuracy-report.json`(이미지별 상세)으로 남습니다.

## `/admin/review`와의 관계

이 스크립트로 분석한 이미지는 **정답을 이미 아는 상태로 테스트한 것**이라, 분석 직후
Supabase `manual_review_labels`에 `source: 'script'`로 자동 기록됩니다. `/admin/review`
화면에도 그대로 뜨지만 🔒 표시와 함께 잠겨 있어 다시 체크할 필요가 없고, 그 화면의
탐지율/혼동행렬 집계에도 그대로 포함됩니다. 사람이 직접 매긴 라벨(`source: 'manual'`)과
달리 API로도 수정이 막혀 있습니다.
