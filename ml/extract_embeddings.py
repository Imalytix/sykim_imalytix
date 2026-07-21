"""
Step 1 — walk ml/data/<category>/<real|ai_generated>/*.{jpg,png,...} and extract
a DINOv2 embedding for every image. Requires a GPU for reasonable throughput on
more than a few hundred images (see 개발지시서 2.5절 — this is the one step
that actually needs the backbone forward pass; everything after this is CPU-only).

Expected data layout (카테고리 다양성 요구사항, 개발지시서 2.2절):

    ml/data/
      person/{real,ai_generated}/
      building/{real,ai_generated}/
      misc/{real,ai_generated}/
      item/{real,ai_generated}/

Usage:
    python extract_embeddings.py
    python extract_embeddings.py --data-dir ./data --out-dir ./artifacts
"""
from __future__ import annotations

import sys

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

import argparse
import sys
from pathlib import Path

import numpy as np
from tqdm import tqdm

from backbone import embed_image

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
CATEGORIES = ["person", "building", "misc", "item"]
LABEL_DIRS = {"real": 0, "ai_generated": 1}


def collect_image_paths(data_dir: Path) -> list[tuple[Path, int, str]]:
    """Returns (path, label, category) tuples for every image under data_dir."""
    items: list[tuple[Path, int, str]] = []
    for category in CATEGORIES:
        for label_dir, label in LABEL_DIRS.items():
            folder = data_dir / category / label_dir
            if not folder.is_dir():
                continue
            for path in sorted(folder.iterdir()):
                if path.suffix.lower() in IMAGE_EXTENSIONS:
                    items.append((path, label, category))
    return items


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", default=str(Path(__file__).parent / "data"))
    parser.add_argument("--out-dir", default=str(Path(__file__).parent / "artifacts"))
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    items = collect_image_paths(data_dir)
    if not items:
        print(f"'{data_dir}' 아래에서 이미지를 찾지 못했습니다.")
        print("ml/data/<category>/{real,ai_generated}/ 구조에 이미지를 채워주세요.")
        sys.exit(1)

    print(f"총 {len(items)}개 이미지 발견. 카테고리별 개수:")
    for category in CATEGORIES:
        n = sum(1 for _, _, c in items if c == category)
        n_real = sum(1 for _, label, c in items if c == category and label == 0)
        n_ai = sum(1 for _, label, c in items if c == category and label == 1)
        print(f"  {category:10s} 총 {n:5d}  (real={n_real}, ai_generated={n_ai})")

    embeddings: list[np.ndarray] = []
    labels: list[int] = []
    categories: list[str] = []
    paths: list[str] = []

    failed = 0
    for path, label, category in tqdm(items, desc="임베딩 추출"):
        try:
            emb = embed_image(str(path))
        except Exception as exc:  # noqa: BLE001 — keep going, report at the end
            print(f"  [실패] {path}: {exc}")
            failed += 1
            continue
        embeddings.append(emb)
        labels.append(label)
        categories.append(category)
        paths.append(str(path))

    if failed:
        print(f"{failed}개 이미지 처리 실패 (위 로그 참고). 나머지 {len(embeddings)}개로 계속 진행합니다.")

    np.save(out_dir / "embeddings.npy", np.stack(embeddings))
    np.save(out_dir / "labels.npy", np.array(labels, dtype=np.int64))
    np.save(out_dir / "categories.npy", np.array(categories))
    np.save(out_dir / "paths.npy", np.array(paths))

    print(f"\n저장 완료 -> {out_dir}/")
    print("  embeddings.npy, labels.npy, categories.npy, paths.npy")
    print("다음 단계: python train_linear_probe.py")


if __name__ == "__main__":
    main()
