"""
Builds ml/data/<category>/ai_generated/ from DiffusionDB — a public, **CC0
(public domain)** dataset of Stable Diffusion images generated from real user
prompts. https://huggingface.co/datasets/poloclub/diffusiondb

CC0 means no license restrictions at all (unlike GenImage/JourneyDB, which we
looked at and skipped — their license terms are unclear/custom and not
obviously safe for a commercial product; see ml/README.md).

⚠️  DiffusionDB is 100% Stable Diffusion output. It covers ONE of the 2-3+
    generators required by 개발지시서 2.2절 — pair it with FLUX (Apache 2.0,
    free via Hugging Face Spaces or local ComfyUI/Diffusers) and/or the
    team's own Midjourney generations. See ml/README.md.

Setup:
    pip install -r requirements.txt   # adds `datasets`
    (no API key needed — CC0, public. First run downloads the chosen subset
    from Hugging Face, which needs internet and can take a while / several GB
    depending on --config.)

Usage:
    python build_dataset_from_diffusiondb.py
    python build_dataset_from_diffusiondb.py --config 2m_random_50k --per-category 150
    python build_dataset_from_diffusiondb.py --category person

Note on --config: DiffusionDB ships as ~16 pre-sized random subsets (e.g.
"2m_random_5k", "2m_random_50k", "large_random_10k", ...). Check the exact
list on the dataset's Hugging Face page if the default below 404s — sizes get
added/renamed occasionally.
"""
from __future__ import annotations

import sys

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

import argparse
import csv
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"

# Matched against each image's prompt text (case-insensitive substring).
CATEGORY_KEYWORDS = {
    "person": ["portrait", "person", "woman", "man", "face", "selfie", "girl", "boy"],
    "building": ["building", "house", "interior", "architecture", "room", "apartment"],
    "misc": ["household", "kitchen", "still life", "desk", "object"],
    "item": ["handbag", "bag", "watch", "wristwatch", "sneaker", "jewelry", "necklace", "purse"],
}

NSFW_THRESHOLD_DEFAULT = 0.5


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="2m_random_50k", help="HF datasets config name (dataset card has the full list)")
    parser.add_argument("--per-category", type=int, default=150)
    parser.add_argument("--category", choices=list(CATEGORY_KEYWORDS), help="이 카테고리만 실행 (생략 시 전체)")
    parser.add_argument("--nsfw-threshold", type=float, default=NSFW_THRESHOLD_DEFAULT)
    args = parser.parse_args()

    from datasets import load_dataset

    print(f"DiffusionDB '{args.config}' 로딩 중 (최초 실행 시 다운로드 — 크기에 따라 시간이 걸릴 수 있음)...")
    # DiffusionDB predates the `datasets` library dropping support for custom
    # loader scripts (hard-removed in datasets>=4.0, hence the pin to 2.21.0
    # in requirements.txt). Even on 2.21.0, running that script requires an
    # explicit opt-in — reasonable here since poloclub/diffusiondb is an
    # established, reputable academic dataset.
    ds = load_dataset("poloclub/diffusiondb", args.config, trust_remote_code=True)["train"]
    print(f"총 {len(ds)}개 항목 로드 완료. 카테고리 키워드로 필터링합니다.\n")

    categories = [args.category] if args.category else list(CATEGORY_KEYWORDS)

    for category in categories:
        out_dir = DATA_DIR / category / "ai_generated"
        out_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = out_dir / "manifest.csv"

        existing = set()
        if manifest_path.exists():
            with open(manifest_path, newline="", encoding="utf-8") as f:
                existing = {row["image_name"] for row in csv.DictReader(f)}

        terms = CATEGORY_KEYWORDS[category]
        rows: list[dict] = []
        skipped_nsfw = 0

        for item in ds:
            if len(rows) >= args.per_category:
                break
            prompt = (item.get("prompt") or "").lower()
            if not any(term in prompt for term in terms):
                continue
            if (item.get("image_nsfw") or 0) > args.nsfw_threshold or (item.get("prompt_nsfw") or 0) > args.nsfw_threshold:
                skipped_nsfw += 1
                continue
            name = item.get("image_name") or f"{category}_{len(rows)}.png"
            if name in existing:
                continue
            dest = out_dir / name
            try:
                item["image"].save(dest)
            except Exception as exc:  # noqa: BLE001
                print(f"  [실패] {name}: {exc}")
                continue
            rows.append({"image_name": name, "prompt": item.get("prompt", ""), "source": "diffusiondb/stable-diffusion"})
            existing.add(name)

        if rows:
            write_header = not manifest_path.exists()
            with open(manifest_path, "a", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
                if write_header:
                    writer.writeheader()
                writer.writerows(rows)

        note = f" (NSFW 점수 초과로 {skipped_nsfw}개 스킵)" if skipped_nsfw else ""
        print(f"  {category}: {len(rows)}장 저장 (manifest: {manifest_path}){note}")

    print("\n완료. Stable Diffusion 이미지만으로는 부족 — FLUX/Midjourney 등 다른 생성기도 섞어주세요 (ml/README.md 참고).")


if __name__ == "__main__":
    main()
