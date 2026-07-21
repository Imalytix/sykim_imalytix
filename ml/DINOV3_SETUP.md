# DINOv3 체크포인트 연결하기 — 개념부터 실전까지

이 문서는 "왜 DINOv2랑 DINOv3는 연결 방식이 다른가"부터 시작해서, 실제로
`dinov3_vits16_pretrain_lvd1689m-08c60483.pth` 파일을 파이프라인에 연결하는
방법까지 설명합니다.

---

## 1. 왜 로딩 방식이 다른가 — 배경 개념

같은 "모델 가중치 파일"이라도 배포 형식이 두 가지로 나뉩니다.

### Hugging Face 포맷 (지금까지 쓰던 DINOv2 방식)

Hugging Face Hub(`huggingface.co`)에 올라간 모델은 `config.json`(모델 구조
정의) + `pytorch_model.bin` 또는 `safetensors`(가중치) + 전처리 설정 파일이
한 세트로 묶여서 저장소 형태로 올라가 있습니다. 그래서 코드에서

```python
AutoModel.from_pretrained("facebook/dinov2-small")
```

한 줄만 쓰면 `transformers` 라이브러리가 이 세트를 통째로 다운로드하고, 모델
구조도 알아서 맞춰서 만들어줍니다. **"어떤 아키텍처인지" + "가중치"가 같이
패키징**돼 있는 게 핵심입니다.

### 원본 체크포인트(raw `.pth`) 포맷 (지금 받으신 DINOv3 방식)

`.pth` 파일 하나는 **순수하게 숫자(가중치) 뭉치**입니다 (PyTorch의
`state_dict` — "이 레이어 이름엔 이 숫자들"이라는 딕셔너리). **어떤
아키텍처에 끼워 넣어야 하는지에 대한 정보가 파일 안에 없습니다.** Meta는
DINOv3를 이런 순수 체크포인트 형태로만 배포합니다 (승인 절차를 거쳐야 받을
수 있는 자료라, Hugging Face Hub의 "누구나 클릭 한 번에 받는" 배포 방식과는
안 맞기 때문으로 추정됩니다).

그래서 가중치를 쓰려면 **"이 숫자들이 들어갈 아키텍처 코드"를 별도로
구해야** 합니다 — 그게 `facebookresearch/dinov3` GitHub 저장소의 코드입니다.
`torch.hub.load(...)`가 하는 일이 바로 이겁니다: GitHub에서 **아키텍처
코드**(공개, 승인 불필요)를 받아오고, 거기에 로컬에 있는 **가중치 파일**
(승인받아 직접 다운로드한 것)을 끼워 넣는 것.

> 한 줄 요약: HF 방식 = "구조+가중치 세트 배송", raw 체크포인트 방식 =
> "구조는 오픈된 설계도(GitHub)에서, 가중치는 승인받은 사람이 직접 조달".

---

## 2. 파일 놓을 위치

```bash
# Windows 예시 — 다운로드 폴더에서 프로젝트로 이동
move "%USERPROFILE%\Downloads\dinov3_vits16_pretrain_lvd1689m-08c60483.pth" ^
     "C:\Users\cubix\Desktop\imalytix-nextjs\ml\checkpoints\"
```

`ml/checkpoints/`는 이미 만들어뒀고 `.gitignore`에도 등록해뒀습니다 (이런
가중치 파일은 각자 승인받아 직접 받는 거라 git에 커밋하면 안 됩니다 —
Meta 라이선스가 개인별 승인을 전제로 하기 때문).

---

## 3. `.env` 설정

`ml/.env.example`을 참고해서 `ml/.env`에 아래 3줄을 추가하세요:

```env
IMALYTIX_BACKBONE_SOURCE=torchhub
IMALYTIX_BACKBONE=dinov3_vits16
IMALYTIX_BACKBONE_WEIGHTS=./checkpoints/dinov3_vits16_pretrain_lvd1689m-08c60483.pth
```

- `IMALYTIX_BACKBONE_SOURCE`: `hf`(기본값, DINOv2) 또는 `torchhub`(DINOv3)
- `IMALYTIX_BACKBONE`: torchhub일 땐 torch.hub의 "엔트리포인트 이름". 파일명의
  `vits16`(ViT-Small, patch size 16)에 대응하는 이름이 `dinov3_vits16`입니다.
- `IMALYTIX_BACKBONE_WEIGHTS`: 방금 옮긴 `.pth` 파일의 경로

---

## 4. `backbone.py`가 실제로 하는 일

`ml/backbone.py`를 두 갈래로 나눠뒀습니다:

```python
if BACKBONE_SOURCE == "torchhub":
    model = torch.hub.load(
        "facebookresearch/dinov3",   # ① GitHub에서 아키텍처 코드 받음 (공개, 승인 불필요)
        "dinov3_vits16",              # ② 그 코드 안에서 "이 구조로 만들어줘"
        source="github",
        weights="./checkpoints/....pth",  # ③ 로컬 가중치 파일을 그 구조에 끼워 넣음
    )
```

`torch.hub.load`를 처음 실행하면 ①번 단계에서 GitHub 저장소를 로컬 캐시
(`~/.cache/torch/hub/`)에 내려받습니다 — **이건 아키텍처 코드일 뿐 가중치가
아니라서 인터넷만 있으면 누구나 받을 수 있는 공개 자료**입니다. 실제 학습된
지능(가중치)은 ③번에서 당신이 승인받아 다운로드한 로컬 파일에서 옵니다.

이미지 전처리(리사이즈·정규화)도 HF 버전과 다르게 직접 정의해뒀습니다
(`torchvision.transforms`) — HF의 `AutoImageProcessor`가 자동으로 해주던
일을, raw 체크포인트에서는 수동으로 맞춰줘야 하기 때문입니다.

---

## 5. 검증 방법 (스모크 테스트)

**중요**: 이 연결 코드는 GPU·인터넷·실제 gated 파일이 모두 있어야 실행되는
코드라, 지금 이 대화에서는(제 개발 환경엔 GPU도 없고 그 파일도 없음)
직접 실행해서 검증하지 못했습니다. DINOv2/DINOv3의 공개된 사용 관례를
근거로 최대한 정확하게 작성했지만, **처음 한 번은 꼭 아래처럼 직접
확인**해주세요:

```bash
cd ml
python -c "
from backbone import embed_image, embedding_dim
print('임베딩 차원:', embedding_dim())   # ViT-S/16이면 384가 나와야 정상
emb = embed_image('data/person/real/아무이미지.jpg')
print('임베딩 shape:', emb.shape)        # (384,) 형태여야 정상
print(emb[:5])                           # 값 몇 개 미리보기 — NaN/전부 0이면 이상 신호
"
```

**정상이면**: `임베딩 차원: 384`, `shape: (384,)`, 값들이 NaN 없이 적당히
분포된 실수들.

---

## 6. 문제가 생기면

### `ModuleNotFoundError: No module named 'torchmetrics'` (또는 `termcolor`)
실제로 겪은 문제입니다 (2026-07-21, 처음 연결 검증할 때). 원인은 우리 코드가
아니라 `facebookresearch/dinov3` 저장소의 `hubconf.py` 자체 구조 때문입니다
— `hubconf.py`가 파일 최상단에서 **모든** entrypoint(분류용 `dinov3_vits16`
뿐 아니라 세그멘테이션용 `dinov3_vit7b16_ms` 등)를 한꺼번에 import하는데,
세그멘테이션 쪽 평가 코드가 `torchmetrics`, `termcolor` 같은 우리와 무관한
패키지에 의존합니다. `torch.hub.load()`가 `dinov3_vits16`만 불러오라고
해도, 파이썬은 `hubconf.py` 파일 전체를 먼저 import해야 해서 이 문제를
피할 수 없습니다.

**해결**: `pip install torchmetrics termcolor` (`ml/requirements.txt`에
이미 반영해뒀습니다). 혹시 다른 이름의 `ModuleNotFoundError`가 또 나오면
같은 원인일 가능성이 높으니 그냥 `pip install <그 패키지명>`으로 채워주면
됩니다 — 우리가 실제로 쓰는 코드 경로와는 상관없는 이유로 막히는 것뿐이라
안전합니다.

### "출력 형태가 dict입니다" 에러가 뜨는 경우
`backbone.py`가 이미 `x_norm_clstoken` / `cls_token` / `pooler_output` 키를
자동으로 찾아보긴 하지만, 그중 아무것도 없으면 에러 메시지에 실제 키 목록이
찍히도록 해뒀습니다. 그 키 이름을 보고 `backbone.py`의 해당 리스트에
추가하면 됩니다.

### `torch.hub.load`가 "Cannot find callable dinov3_vits16" 같은 에러
`facebookresearch/dinov3` 저장소의 `hubconf.py`에 정의된 실제 함수 이름이
다를 수 있습니다 (버전에 따라 `dinov3_vits16` 대신 다른 이름을 쓸 수도
있음). 아래로 확인:
```bash
python -c "import torch; print(torch.hub.list('facebookresearch/dinov3', source='github'))"
```
여기 출력되는 이름 중 하나를 `ml/.env`의 `IMALYTIX_BACKBONE`에 넣으세요.

### 이미지 크기 관련 에러
ViT-S/16은 이미지 한 변이 16으로 나눠떨어져야 합니다. 지금 전처리는
256으로 리사이즈 후 224로 센터크롭(224 = 16×14)이라 문제없어야 하지만,
혹시 에러가 나면 `backbone.py`의 `CenterCrop(224)` 값을 16의 배수로
유지한 채 조정하세요.

### 임베딩 차원이 384가 아니라 다른 값이 나옴
체크포인트가 ViT-S가 아니라 다른 크기(Base/Large)일 수 있습니다. 파일명의
`vits16` 부분을 다시 확인하세요. 차원이 달라도 코드는 그대로 동작합니다
(`embedding_dim()`이 실제 모델에서 동적으로 읽어오도록 만들어놨음) — 다만
`train_linear_probe.py` 쪽 주석의 "384차원" 언급은 그냥 참고용 숫자일 뿐이라
실제로는 어떤 차원이든 자동으로 맞춰집니다.

---

## 7. 라이선스 — 다시 한번 리마인드

이전에 설명드렸던 DINOv3 License 조항 중, 이제 실제로 적용되는 부분:

- **재배포 시 "Built with DINOv3" 표기 의무** — Imalytix 서비스에 실제로
  이 모델을 탑재해서 배포하면 어딘가에 이 문구를 넣어야 합니다 (지금은 학습
  단계라 아직 해당 없음, 서비스 연결 시점에 다시 챙기면 됩니다).
- **`.pth` 파일 자체를 다른 사람과 공유/재배포 금지** — 팀원마다 각자
  승인받아 개별적으로 받아야 합니다 (git에 커밋 안 하는 이유이기도 함).
