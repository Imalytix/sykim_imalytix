# 성능/회귀 테스트 이미지 데이터셋

이 폴더는 파이프라인의 주요 분기(포맷, 메타데이터 탐지, 검증 실패)를 건드리는
합성(synthetic) 테스트 이미지를 생성/실행하는 스크립트를 담고 있습니다.
이미지 자체는 매번 로컬에서 생성되며 `.gitignore`에 포함되어 저장소에는
커밋되지 않습니다 — 아래 명령으로 언제든 재생성하세요.

## 사용법

```bash
# 1) 이미지 데이터셋 생성 (test-data/images/ 에 10개 파일 + manifest.json)
npm run test:dataset

# 2) 분석 대상 서버를 별도 터미널에서 실행
npm run dev

# 3) 전체 이미지를 /api/analyze/image 에 순차 호출하며 지연시간/결과 측정
npm run test:perf

# 배포된 서버를 대상으로 하려면:
PERF_BASE_URL=https://your-deployment.example.com npm run test:perf
```

`test:perf`는 `test-data/report.json`에 각 이미지별 HTTP 상태, 소요 시간(ms),
최종 점수, provider별 점수/에러를 기록하고, 콘솔에 min/median/avg/max
응답시간 요약을 출력합니다.

## 데이터셋 구성

| 파일 | 목적 |
|---|---|
| `small-photo.jpg` | 기본 케이스 (작은 JPEG) |
| `large-photo.jpg` | `IMAGE_LONG_SIDE` 리사이즈 경로 + 대용량 처리 지연시간 |
| `random-noise.jpg` | 실사/합성 판별이 애매한 극단 케이스 |
| `flat-illustration.png` | `detectImageType()`의 illustration 분기 |
| `pixel-art.png` | `detectImageType()`의 pixel_art 분기 (고유색 극소) |
| `fake-ai-metadata.png` | PNG tEXt에 Stable Diffusion 파라미터 삽입 → `metadata_score` 상승 확인 |
| `fake-camera-exif.jpg` | 카메라 Make/Model/LensModel EXIF → 실제 촬영 가능성 반영(감점) 확인 |
| `photo.webp` | WEBP 포맷 지원 확인 |
| `corrupt.jpg` | 손상된 파일 → `ImageValidationError` (400) 확인 |
| `oversized.jpg` | `MAX_FILE_SIZE_MB` 초과 → 크기 거부 (400) 확인 |

`corrupt.jpg`, `oversized.jpg`는 **실패가 예상되는** 케이스라 `run-perf-test.js`가
non-200 응답을 정상(pass)으로 취급합니다.
