"""
Builds ml/data/<category>/real/ from the official Unsplash **Lite** Dataset —
NOT the live search API (see note below on why).

Setup:
    1. Download the Lite dataset (free, ~700MB zip) from:
           https://unsplash.com/data/lite/latest
       (Accept the dataset terms on that page — this is a manual click-through
       step, not automatable.)
    2. Unzip it somewhere, e.g. ml/unsplash-lite/. You should see files named
       photos.tsv000 and keywords.tsv000 among others.
    3. pip install -r requirements.txt (adds pandas)

Usage:
    python build_dataset_from_unsplash_lite.py --dataset-dir ./unsplash-lite
    python build_dataset_from_unsplash_lite.py --dataset-dir ./unsplash-lite --per-category 150

--------------------------------------------------------------------------
Why this script exists instead of just using the search API directly:

Unsplash's API Terms (Section 12, "Usage and Quotas") say:

    "In the event you desire to use the Content sourced from the API in
    connection with any machine learning and/or artificial intelligence
    purposes... please visit https://unsplash.com/data for more information."

i.e. the regular /search/photos API is not the intended path for ML training
data — Unsplash has a separate Dataset product for that, with its own terms
(TERMS.md in https://github.com/unsplash/datasets). Two tiers exist:

  - Lite (25k images, free): commercial use permitted, including training ML
    models used commercially. This is what this script uses.
  - Full (4.8M images, apply required): NON-commercial only — a model trained
    on it "must not be used for commercial purposes". Do NOT use the Full
    dataset for Imalytix (it's a commercial product) — it would make the
    resulting model legally unusable for the actual service.
--------------------------------------------------------------------------
"""
from __future__ import annotations

import sys

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

import argparse
import csv
from pathlib import Path

import pandas as pd
import requests

DATA_DIR = Path(__file__).parent / "data"

# Matched against the Lite dataset's keywords.tsv000 `keyword` column
# (case-insensitive substring match). Same 4 categories as
# download_real_images.py / 개발지시서 2.2절.
CATEGORY_KEYWORDS = {
    "person": ["portrait", "person", "face", "selfie", "human"],
    "building": ["building", "architecture", "interior design", "apartment", "house"],
    "misc": ["household", "kitchen", "everyday object", "desk"],
    "item": ["handbag", "bag", "watch", "wristwatch", "sneaker", "jewelry"],
}


def load_tables(dataset_dir: Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    photos_path = dataset_dir / "photos.tsv000"
    keywords_path = dataset_dir / "keywords.tsv000"
    if not photos_path.exists() or not keywords_path.exists():
        raise SystemExit(
            f"'{dataset_dir}'에서 photos.tsv000 / keywords.tsv000를 찾지 못했습니다.\n"
            "https://unsplash.com/data/lite/latest 에서 Lite 데이터셋을 받아 압축 해제한 폴더를 --dataset-dir로 지정하세요."
        )
    photos = pd.read_csv(photos_path, sep="\t", header=0, low_memory=False)
    keywords = pd.read_csv(keywords_path, sep="\t", header=0, low_memory=False)
    return photos, keywords


def photo_ids_for_category(keywords: pd.DataFrame, category: str) -> set[str]:
    terms = CATEGORY_KEYWORDS[category]
    pattern = "|".join(terms)
    mask = keywords["keyword"].astype(str).str.contains(pattern, case=False, na=False, regex=True)
    return set(keywords.loc[mask, "photo_id"].unique())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-dir", required=True, help="압축 해제한 Unsplash Lite 데이터셋 폴더")
    parser.add_argument("--per-category", type=int, default=150)
    parser.add_argument("--category", choices=list(CATEGORY_KEYWORDS), help="이 카테고리만 실행 (생략 시 전체)")
    args = parser.parse_args()

    photos, keywords = load_tables(Path(args.dataset_dir))
    photos = photos.set_index("photo_id", drop=False)

    categories = [args.category] if args.category else list(CATEGORY_KEYWORDS)

    for category in categories:
        out_dir = DATA_DIR / category / "real"
        out_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = out_dir / "manifest.csv"

        existing_ids = set()
        if manifest_path.exists():
            with open(manifest_path, newline="", encoding="utf-8") as f:
                existing_ids = {row["photo_id"] for row in csv.DictReader(f)}

        matched_ids = photo_ids_for_category(keywords, category)
        matched_ids -= existing_ids
        matched_ids = {pid for pid in matched_ids if pid in photos.index}

        target_ids = list(matched_ids)[: args.per_category]
        print(f"\n=== {category} — 매칭된 사진 {len(matched_ids)}장 중 {len(target_ids)}장 다운로드 ===")

        rows: list[dict] = []
        for photo_id in target_ids:
            row = photos.loc[photo_id]
            image_url = f"{row['photo_image_url']}?w=1080&fm=jpg"
            dest = out_dir / f"{photo_id}.jpg"
            try:
                resp = requests.get(image_url, timeout=60)
                resp.raise_for_status()
                dest.write_bytes(resp.content)
            except requests.RequestException as exc:
                print(f"  [실패] {photo_id}: {exc}")
                continue
            rows.append(
                {
                    "photo_id": photo_id,
                    "filename": dest.name,
                    "photographer": f"{row.get('photographer_first_name', '')} {row.get('photographer_last_name', '')}".strip(),
                    "photographer_username": row.get("photographer_username", ""),
                    "photo_page": row.get("photo_url", ""),
                }
            )

        if rows:
            write_header = not manifest_path.exists()
            with open(manifest_path, "a", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
                if write_header:
                    writer.writeheader()
                writer.writerows(rows)

        print(f"  {category}: {len(rows)}장 저장 완료 (manifest: {manifest_path})")

    print("\n완료. 다음: ml/data/<category>/ai_generated/ 채운 뒤 python extract_embeddings.py")


if __name__ == "__main__":
    main()
