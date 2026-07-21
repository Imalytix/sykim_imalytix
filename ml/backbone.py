"""
Frozen vision backbone -> single embedding vector per image.

Supports two ways of loading a backbone (see ml/DINOV3_SETUP.md for the full
explanation of why there are two, and how to switch between them):

  "hf"        — Hugging Face `transformers` AutoModel. Used for DINOv2
                (facebook/dinov2-small, Apache 2.0, no approval needed).
                This is the default.

  "torchhub"  — torch.hub + a local gated checkpoint file on disk. Used for
                DINOv3, whose weights Meta distributes as a plain .pth file
                (not a Hugging Face model repo) after their access-approval
                process. You must already have downloaded the .pth yourself —
                this code never fetches gated weights on its own.

Switch via env vars (put these in ml/.env):
    IMALYTIX_BACKBONE_SOURCE=torchhub
    IMALYTIX_BACKBONE=dinov3_vits16
    IMALYTIX_BACKBONE_WEIGHTS=./checkpoints/dinov3_vits16_pretrain_lvd1689m-08c60483.pth
"""
from __future__ import annotations

import sys

# Windows terminals often default to a legacy codepage (cp949 on Korean
# Windows) instead of UTF-8, which crashes on any Korean print() output.
# Force UTF-8 so these scripts work out of the box regardless of the
# terminal's configured codepage.
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

import os
from pathlib import Path

import torch
from dotenv import load_dotenv
from PIL import Image

load_dotenv(Path(__file__).parent / ".env")

BACKBONE_SOURCE = os.environ.get("IMALYTIX_BACKBONE_SOURCE", "hf")

# "hf" source: a Hugging Face Hub model id. distilled small variant fits
# comfortably in 6GB VRAM (see 개발지시서 2.5절) — do NOT point this at a
# 7B-parameter teacher checkpoint; those need 28GB+ FP32.
# "torchhub" source: the torch.hub entrypoint name (e.g. "dinov3_vits16").
BACKBONE_MODEL_ID = os.environ.get("IMALYTIX_BACKBONE", "facebook/dinov2-small")

# torchhub source only: local path to the gated .pth checkpoint you already
# downloaded through Meta's approval process.
BACKBONE_WEIGHTS_PATH = os.environ.get("IMALYTIX_BACKBONE_WEIGHTS")

_device = "cuda" if torch.cuda.is_available() else "cpu"
_processor = None
_model = None
_transform = None


def _lazy_load_hf():
    global _processor, _model
    if _model is None:
        from transformers import AutoImageProcessor, AutoModel

        _processor = AutoImageProcessor.from_pretrained(BACKBONE_MODEL_ID)
        _model = AutoModel.from_pretrained(BACKBONE_MODEL_ID).to(_device).eval()
    return _processor, _model


def _lazy_load_torchhub():
    global _model, _transform
    if _model is None:
        if not BACKBONE_WEIGHTS_PATH:
            raise RuntimeError(
                "IMALYTIX_BACKBONE_SOURCE=torchhub인데 IMALYTIX_BACKBONE_WEIGHTS가 "
                "설정되지 않았습니다. ml/.env에 로컬 .pth 경로를 지정하세요. "
                "자세한 내용은 ml/DINOV3_SETUP.md 참고."
            )
        weights_path = os.path.abspath(BACKBONE_WEIGHTS_PATH)
        if not os.path.isfile(weights_path):
            raise FileNotFoundError(f"체크포인트 파일을 찾을 수 없습니다: {weights_path}")

        import torchvision.transforms as T

        # torch.hub caches facebookresearch/dinov3's *code* (architecture
        # definition) from GitHub on first run — that part is public and
        # ungated. Only the `weights=` file is the gated part, and it comes
        # from your local disk, never downloaded by this call.
        _model = (
            torch.hub.load(
                "facebookresearch/dinov3",
                BACKBONE_MODEL_ID,
                source="github",
                weights=weights_path,
            )
            .to(_device)
            .eval()
        )

        # Standard ViT/ImageNet-style eval preprocessing. This is the same
        # recipe DINOv2's official repo documents; DINOv3 follows the same
        # convention. 224 is divisible by the ViT-S/16 patch size (16), which
        # is required.
        _transform = T.Compose(
            [
                T.Resize(256, interpolation=T.InterpolationMode.BICUBIC),
                T.CenterCrop(224),
                T.ToTensor(),
                T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
            ]
        )
    return _model, _transform


@torch.no_grad()
def embed_image(image_path: str):
    """Returns the pooled embedding (1D numpy array) for one image."""
    img = Image.open(image_path).convert("RGB")

    if BACKBONE_SOURCE == "torchhub":
        model, transform = _lazy_load_torchhub()
        pixel_values = transform(img).unsqueeze(0).to(_device)
        out = model(pixel_values)
        # Defensive: DINO hub models conventionally return a plain pooled
        # tensor of shape (batch, embed_dim) when called directly. Some
        # variants/forward modes instead return a dict of named tensors — if
        # that happens here, fall back to the conventional CLS-token key
        # rather than crashing. Verify with the smoke test in
        # ml/DINOV3_SETUP.md the first time you wire up a new checkpoint.
        if isinstance(out, dict):
            for key in ("x_norm_clstoken", "cls_token", "pooler_output"):
                if key in out:
                    out = out[key]
                    break
            else:
                raise RuntimeError(
                    f"예상치 못한 모델 출력 형태(dict, keys={list(out.keys())}). "
                    "ml/DINOV3_SETUP.md의 '출력 형태가 다르면' 절 참고."
                )
        return out.squeeze(0).detach().cpu().numpy()

    processor, model = _lazy_load_hf()
    inputs = processor(images=img, return_tensors="pt").to(_device)
    out = model(**inputs)
    cls_token = out.last_hidden_state[:, 0, :]
    return cls_token.squeeze(0).cpu().numpy()


@torch.no_grad()
def embedding_dim() -> int:
    """DINOv2-small / DINOv3 ViT-S/16 = 384. Inferred via a dummy forward pass
    for torchhub models (more robust than hardcoding), or read from config
    for HF models."""
    if BACKBONE_SOURCE == "torchhub":
        model, _ = _lazy_load_torchhub()
        dummy_out = model(torch.zeros(1, 3, 224, 224, device=_device))
        if isinstance(dummy_out, dict):
            dummy_out = dummy_out.get("x_norm_clstoken") or dummy_out.get("cls_token")
        return dummy_out.shape[-1]
    _, model = _lazy_load_hf()
    return model.config.hidden_size
