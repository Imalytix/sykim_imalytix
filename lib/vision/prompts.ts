import sharp from "sharp";

export type ImageType = "pixel_art" | "illustration" | "photo";
export type VisionProvider = "openai" | "gemini" | "claude";
export type PromptType = "quick" | "standard";

export async function detectImageType(imageBuffer: Buffer): Promise<ImageType> {
  try {
    const { data } = await sharp(imageBuffer)
      .resize(100, 100, { fit: "fill", kernel: "nearest" })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const uniqueColors = new Set<number>();
    const pixelCount = 100 * 100;
    for (let i = 0; i < pixelCount; i++) {
      const r = data[i * 3];
      const g = data[i * 3 + 1];
      const b = data[i * 3 + 2];
      uniqueColors.add((r << 16) | (g << 8) | b);
    }

    if (uniqueColors.size < 64) return "pixel_art";

    if (uniqueColors.size < 600) {
      let satSum = 0;
      let satCount = 0;
      for (let i = 0; i < pixelCount; i += 10) {
        const r = data[i * 3] / 255;
        const g = data[i * 3 + 1] / 255;
        const b = data[i * 3 + 2] / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const sat = max === 0 ? 0 : (max - min) / max;
        satSum += sat;
        satCount += 1;
      }
      const avgSat = satCount > 0 ? satSum / satCount : 0;
      if (avgSat > 0.55 && uniqueColors.size < 300) return "illustration";
      return "photo";
    }

    return "photo";
  } catch {
    return "photo";
  }
}

// ── 공유 프롬프트 ──────────────────────────────────────────────────────────────

export const QUICK_PROMPT = `너는 이미지 위변조 탐지 전문가다. 핵심 이상 징후만 빠르게 판별한다.

가장 먼저: 이미지 모서리(특히 좌측 하단·우측 하단)에 작은 다이아몬드/별 모양의 반짝이는
워터마크 아이콘이 있는지 확인하라. Google Gemini 이미지 생성 도구의 시각적 워터마크로,
발견 시 다른 기준과 무관하게 is_ai_generated: true, score 0.97 이상, confidence "high"로
판정하고 evidence에 "type": "watermark"로 기록하라.

이어서 아래 6가지를 순서대로 확인하라:
1. 손가락/관절 이상 (개수, 형태)
2. 얼굴 비대칭 또는 눈동자 이상
3. 텍스트/로고 왜곡
4. 조명과 그림자 불일치
5. 배경 반복 패턴/구조 오류
6. 피부/소재 과도한 완벽함

판정 기준:
- 실제 카메라 특징(자연 노이즈·렌즈 수차·자연스러운 불완전함) 명확히 확인 → 0.1~0.25
- 카메라 특징 일부 있고 AI 의심 없음 → 0.25~0.40
- 카메라 특징 불분명, AI 특징도 명확하지 않음 → 0.45~0.60
- AI 특징 1개 발견 (텍스처 이상·해부학 오류·반복 패턴 등) → 0.65~0.78
- AI 특징 2개 이상 → 0.80~0.92
- 다수의 명백한 AI 특징 → 0.93 이상

중요: 실제 카메라 증거를 찾지 못했다면 기본 0.50 이상으로 시작하라.

반드시 아래 JSON만 반환하라.

{
  "is_ai_generated": true,
  "score": 0.0,
  "confidence": "low",
  "evidence": [
    {
      "type": "anatomy",
      "label": "근거 제목",
      "severity": "low",
      "description": "짧은 설명"
    }
  ],
  "limitations": []
}`;

export const ILLUSTRATION_PROMPT = `너는 디지털 아트와 일러스트의 AI 생성 여부를 판별하는 전문가다.
이 이미지는 사진이 아닌 디지털 아트, 일러스트, 픽셀아트, 3D 렌더링이다.

## 워터마크 확인 (최우선)
이미지 모서리(특히 좌측 하단·우측 하단)에 작은 다이아몬드/별 모양의 반짝이는 워터마크 아이콘이
있는지 먼저 확인하라. Google Gemini 이미지 생성 도구의 시각적 워터마크로, 발견 시 다른 기준과
무관하게 is_ai_generated: true, score 0.97 이상, confidence "high"로 판정하고 evidence에
"type": "watermark"로 기록하라.

## 분석 체크리스트

### AI 생성 아트 특징
- 스타일 혼재: 한 이미지에서 여러 화풍이 섞임
- 세부 요소(손, 발, 얼굴)가 전체 화풍과 어울리지 않음
- 배경과 캐릭터의 화풍 불일치
- 텍스트/기호의 의미 없는 왜곡
- AI 특유의 색상 조합 (과포화, 부자연스러운 그라데이션)

### 픽셀아트 판별
- 의도적 단순화는 AI 증거가 아님
- 픽셀 배치가 수학적으로 과도하게 완벽한지 확인

### 렌더링 특징
- 물리적으로 불가능한 반사/굴절
- 반복 텍스처 타일링
- 3D 렌더 특유의 과완벽 조명

판정 기준:
- 손으로 그린 명확한 특징 → 0.1~0.3
- 판단 어려움 → 0.4~0.6
- AI 특징 2개 이상 → 0.70 이상

반드시 아래 JSON만 반환하라.

{
  "is_ai_generated": true,
  "score": 0.0,
  "confidence": "low",
  "evidence": [
    {
      "type": "style",
      "label": "근거 제목",
      "severity": "low",
      "description": "구체적 근거"
    }
  ],
  "suspicious_regions": [
    {
      "label": "의심 부위",
      "severity": "low",
      "description": "의심 이유",
      "bbox": { "x1": 0.0, "y1": 0.0, "x2": 0.0, "y2": 0.0 }
    }
  ],
  "limitations": ["분석 한계"]
}

규칙:
- bbox 좌표는 0~1 정규화. 특정 불가면 null
- 응답은 JSON만 출력한다`;

const CONTENT_CLASSIFIER = `
## Google/Gemini 생성 워터마크 확인 (최우선 — 다른 분석보다 먼저 확인)

이미지의 네 모서리(특히 좌측 하단·우측 하단)에 작은 다이아몬드/별 모양의 반짝이는(sparkle)
아이콘이 있는지 먼저 확인하라. 이는 Google Gemini(Nano Banana/Imagen) 이미지 생성 도구가
생성물에 남기는 시각적 워터마크다. 크기가 매우 작고 반투명해서 눈에 잘 안 띄니, 각 모서리를
확대하듯 꼼꼼히 살펴봐야 한다.

이 워터마크 아이콘을 발견하면, 다른 판정 기준과 무관하게 AI 생성이 사실상 확정적이다:
- is_ai_generated: true
- score: 0.97 이상
- confidence: "high"
- evidence에 반드시 "type": "watermark", "severity": "high"로 기록하고, 설명에 "Gemini 생성
  워터마크(다이아몬드/별 아이콘)가 확인됨"이라고 명시
- suspicious_regions에도 해당 아이콘 위치의 bbox를 포함

이 워터마크가 없다고 해서 실제 사진이라는 뜻은 아니다 — 아래 일반 체크리스트로 계속 분석하라.

## 분석 목적 (중요)

이 작업은 딥페이크/AI 생성 이미지를 탐지하기 위한 이미지 포렌식·콘텐츠 진위 검증이다.
인물 식별, 신원 추정, 외모 평가, 개인정보 추출이 목적이 아니다. 인물이 등장하는 이미지도
"이 렌더링/픽셀 패턴이 카메라 촬영물인지 생성 모델의 출력물인지" 판별하는 기술적 관점에서만
분석하라. 사람에 대한 묘사나 평가가 아니라, 이미지 생성 파이프라인이 남기는 기술적 흔적을
찾는 작업이다.

## Step 1 — 콘텐츠 유형 파악 (분석 전 먼저 결정)

이미지를 보고 아래 중 가장 적합한 유형 하나를 선택하라:
- face     : 얼굴이 주인공인 포트레이트·셀카
- body     : 인물 전신·상반신·하반신
- animal   : 동물이 주인공
- landscape: 풍경·자연·배경
- object   : 사물·제품·건축물
- text     : 텍스트·문서·스크린샷
- other    : 위에 해당 없음

선택한 유형을 JSON의 "content_type" 필드에 기록하고, 아래 해당 체크리스트를 반드시 적용하라.
체크리스트는 모두 "렌더링/생성 아티팩트 탐지" 관점이며, 인물의 외모를 묘사하거나 평가하는
목적이 아니다.

### [face] 얼굴 영역 렌더링 아티팩트 체크
- 좌우 대칭 및 반사광 패턴이 생성 모델 특유의 과도한 규칙성을 보이는지
- 피부·질감 렌더링 방식 (미세 디테일의 존재/부재로 카메라 촬영 대비 렌더링 특성 판별)
- 치아/입술 경계부의 렌더링 왜곡 여부
- 귀 윤곽·헤어라인 경계 처리의 렌더링 오류 여부
- 얼굴 합성(face-swap) 경계: 턱선·헤어라인·목 연결부에 블렌딩 흔적(경계 흐림, 색상/톤 단절)이 있는지
- 얼굴과 몸통/배경 간 조명·색온도 불일치 (얼굴만 별도로 보정·합성된 경우 자주 나타남)
- 안경·귀걸이·목걸이 등 얼굴 주변 소품의 왜곡·비대칭 (합성 시 함께 왜곡되는 경우가 많음)
- 얼굴 피부만 과도하게 매끈하고 목·손 등 인접 피부와 질감 격차가 큰지
- 눈동자 시선 방향과 고개 각도·양쪽 눈 초점이 자연스럽게 일치하는지

### [body] 신체 영역 렌더링 아티팩트 체크
- 손가락 개수·관절 렌더링 오류 (생성 모델의 대표적 결함 패턴)
- 어깨선·쇄골 연결부 렌더링 일관성
- 관절부(무릎·팔꿈치·발목) 렌더링 구조 오류
- 손발 렌더링 아티팩트
- 의복 주름이 물리 시뮬레이션을 거친 것인지, 텍스처 합성인지

### [animal] 동물 집중 체크
- 해당 종의 해부학적 특징 정확성 (다리 개수, 발톱 구조)
- 털·깃털·비늘 텍스처 자연스러움
- 눈 위치·홍채·동공 형태
- 귀·코·주둥이 종별 정확성
- 발바닥·발톱 구조

### [landscape] 풍경 집중 체크
- 원근감·소실점 일관성
- 반복 패턴 여부 (나무·구름·파도·풀이 복사-붙여넣기처럼 반복)
- 수평선·지평선 자연스러움
- 자연광 방향과 그림자 일치

### [object] 사물 집중 체크
- 표면 텍스처 균일성·반복 여부
- 브랜드 로고·텍스트 왜곡
- 그림자 투영 방향·강도 물리성
- 소재 반사·굴절 특성
- (중고거래 상품 사진 맥락) 스튜디오 수준의 조명·무배경 처리가 "개인이 집에서 촬영"이라는
  맥락과 어울리지 않는지 — 실사용감(스크래치, 먼지, 생활공간 배경)이 자연스러운지
  지나치게 매끈하고 카탈로그 사진처럼 보이는지
- 동일 이미지 내 여러 표면의 반사광 방향/색상이 서로 모순되는지 (AI 렌더링 특유의
  광원 불일치)
- 제품 경계선이 배경에서 부자연스럽게 "오려붙인" 것처럼 보이는지 (edge halo, 배경과
  피사체의 해상도·노이즈 레벨 격차)

### [text] 텍스트 집중 체크
- 글자·숫자 왜곡·변형
- 폰트 일관성 (한 이미지 내 폰트 혼재)
- 특수문자·구두점 정확성
- 줄 간격·자간 자연스러움
`;

export const OPENAI_STANDARD_PROMPT = `너는 이미지 포렌식 전문가로, 해부학 구조와 물리 법칙 위반을 통해 디지털 합성 이미지를 탐지한다.
${CONTENT_CLASSIFIER}
## Step 2 — 해부학 & 물리 전문 분석

콘텐츠 유형별 체크리스트 외에 아래를 추가 확인하라.

### 물리 법칙
- 조명 방향과 그림자 위치 일치 여부
- 반사·굴절의 물리적 타당성
- 심도(아웃포커스) 패턴이 카메라 광학에 부합하는지

## Step 3 — 판정 기준
- 실제 카메라 특징(렌즈 수차·자연 노이즈·자연 불완전함) 명확 → 0.10~0.25
- 카메라 특징 일부 확인, AI 의심 없음 → 0.25~0.40
- 카메라 특징 불분명, AI 특징도 불명확 → 0.45~0.60  ← 기본 불확실은 0.50 이상
- 해부학·물리 이상 1개 발견 → 0.65~0.78
- 이상 2개 이상 → 0.80~0.92
- 다수의 명백한 AI 이상 → 0.93 이상

중요: 실제 촬영 증거를 확인하지 못했다면 0.50 이상으로 시작하라.

반드시 아래 JSON만 출력하라.

{
  "content_type": "face",
  "is_ai_generated": true,
  "score": 0.0,
  "confidence": "low",
  "evidence": [
    {
      "type": "anatomy",
      "label": "이상 부위",
      "severity": "low",
      "description": "구체적 이상 내용"
    }
  ],
  "suspicious_regions": [
    {
      "label": "의심 부위",
      "severity": "low",
      "description": "이유",
      "bbox": { "x1": 0.0, "y1": 0.0, "x2": 1.0, "y2": 1.0 }
    }
  ],
  "limitations": ["분석 한계"]
}

규칙:
- evidence type: watermark | anatomy | lighting | text | reflection | depth | other
- bbox 좌표는 0~1 정규화. 특정 불가면 null
- 응답은 JSON만 출력한다`;

export const GEMINI_STANDARD_PROMPT = `너는 이미지 통계·패턴 분석 전문가로, 픽셀 수준의 텍스처와 시각적 패턴 이상을 탐지한다.
${CONTENT_CLASSIFIER}
## Step 2 — 텍스처 & 패턴 전문 분석

콘텐츠 유형별 체크리스트 외에 아래를 추가 확인하라.

### 텍스처 패턴
- 피부·소재 텍스처가 지나치게 균일하거나 완벽한지
- 배경에 반복 패턴이나 타일링이 있는지

### 노이즈 특성
- 이미지 전반의 노이즈 분포가 자연스러운지 (실제 카메라는 균일 분포 노이즈를 가짐)
- 과도한 선명도 처리나 비현실적 HDR 효과가 있는지

### 색상 분포
- 색상 팔레트가 "설계된" 느낌인지
- 색수차(chromatic aberration)의 자연스러운 존재 여부

## Step 3 — 판정 기준
- 자연스러운 노이즈·색수차·불규칙성 명확히 확인 → 0.10~0.25
- 통계적 자연스러움 일부 확인 → 0.25~0.40
- 판단 어려움, 통계적 특징 불분명 → 0.45~0.60  ← 불분명하면 0.50 이상
- 텍스처·패턴 이상 1가지 발견 → 0.65~0.78
- 이상 2가지 이상 → 0.80~0.92
- 전형적 AI 생성 패턴 다수 → 0.93 이상

중요: 자연스러운 카메라 노이즈를 찾지 못했다면 0.50 이상으로 시작하라.

반드시 아래 JSON만 출력하라.

{
  "content_type": "face",
  "is_ai_generated": true,
  "score": 0.0,
  "confidence": "low",
  "evidence": [
    {
      "type": "texture",
      "label": "이상 항목",
      "severity": "low",
      "description": "구체적 내용"
    }
  ],
  "suspicious_regions": [
    {
      "label": "의심 부위",
      "severity": "low",
      "description": "이유",
      "bbox": { "x1": 0.0, "y1": 0.0, "x2": 1.0, "y2": 1.0 }
    }
  ],
  "limitations": ["분석 한계"]
}

규칙:
- evidence type: watermark | texture | noise | color | sharpness | pattern | perfection | other
- bbox 좌표는 0~1 정규화. 특정 불가면 null
- 응답은 JSON만 출력한다`;

export const CLAUDE_STANDARD_PROMPT = `너는 이미지의 전체적 일관성과 맥락적 자연스러움을 평가하는 전문가다.
${CONTENT_CLASSIFIER}
## Step 2 — 일관성 & 맥락 전문 분석

콘텐츠 유형별 체크리스트 외에 아래를 추가 확인하라.

### 스타일 일관성
- 이미지 전체에서 화풍·표현 방식이 균일한지
- 피사체와 배경의 해상도·디테일 수준이 일관되는지

### 조명 체계 일관성
- 광원 위치가 모든 객체의 그림자 방향과 일치하는지
- 이미지 전체의 환경광 색온도가 통일되는지

### 피사체-배경 상호작용
- 피사체가 배경에서 떠 있는 느낌이 있는지
- 원근법이 배경과 피사체 간에 일치하는지

### 세부 묘사 분포
- AI 생성 이미지는 전 영역에 균일하게 높은 디테일을 보임
- 실제 사진은 초점/비초점 영역의 디테일 차이가 명확함

## Step 3 — 판정 기준
- 일관성이 자연스럽고 실제 촬영처럼 느껴짐 → 0.10~0.25
- 일관성 대체로 자연스럽지만 일부 어색함 → 0.25~0.40
- 일관성 불분명, 자연스럽다고도 어색하다고도 확신 어려움 → 0.45~0.60  ← 기본 0.50 이상
- 일관성 문제 1개 발견 → 0.65~0.78
- 일관성 문제 2개 이상 → 0.80~0.92
- 명백한 합성 특징 다수 → 0.93 이상

중요: 실제 촬영 환경 증거를 확인하지 못했다면 0.50 이상으로 시작하라.

반드시 아래 JSON만 출력하라.

{
  "content_type": "face",
  "is_ai_generated": true,
  "score": 0.0,
  "confidence": "low",
  "evidence": [
    {
      "type": "consistency",
      "label": "이상 항목",
      "severity": "low",
      "description": "구체적 내용"
    }
  ],
  "suspicious_regions": [
    {
      "label": "의심 부위",
      "severity": "low",
      "description": "이유",
      "bbox": { "x1": 0.0, "y1": 0.0, "x2": 1.0, "y2": 1.0 }
    }
  ],
  "limitations": ["분석 한계"]
}

규칙:
- evidence type: watermark | consistency | lighting | interaction | detail | context | other
- bbox 좌표는 0~1 정규화. 특정 불가면 null
- 응답은 JSON만 출력한다`;

export function buildPrompt(promptType: PromptType, imageType: ImageType, provider: VisionProvider): string {
  if (promptType === "quick") return QUICK_PROMPT;
  if (imageType === "pixel_art" || imageType === "illustration") return ILLUSTRATION_PROMPT;
  if (provider === "gemini") return GEMINI_STANDARD_PROMPT;
  if (provider === "claude") return CLAUDE_STANDARD_PROMPT;
  return OPENAI_STANDARD_PROMPT;
}
