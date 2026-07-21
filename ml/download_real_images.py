"""
⚠️  DO NOT use this script's output as ML training data. Use
    build_dataset_from_unsplash_lite.py instead.

    Unsplash's API Terms (Section 12) explicitly say content pulled via the
    regular search API (what this script uses) is not meant for "machine
    learning and/or artificial intelligence purposes" — that's what their
    separate Dataset product (unsplash.com/data) is for, which has its own
    license explicitly permitting commercial ML training. Using this script's
    downloads to train Imalytix's classifier would be off the terms this API
    key was granted under.

    Kept around only in case it's useful for something non-training (demos,
    manual browsing, UI mockups) — for the real training data pipeline, use
    build_dataset_from_unsplash_lite.py.

---

Downloads real (non-AI) photos from Unsplash into ml/data/<category>/real/,
covering the 4 categories required by 개발지시서 v2 2.2절 (인물/건물/잡화/물품).

Setup:
    1. https://unsplash.com/developers -> New Application -> copy the "Access Key"
       (a free "Demo" app is enough to start; Unsplash rate-limits Demo apps to
       50 requests/hour — this script respects that and backs off automatically)
    2. Put the key in ml/.env:  UNSPLASH_ACCESS_KEY=your_key_here
    3. pip install -r requirements.txt

Usage:
    python download_real_images.py                      # default: 60 photos/category
    python download_real_images.py --per-category 150
    python download_real_images.py --category person     # just one category

Compliance note: Unsplash's API guidelines require pinging `download_location`
when a photo is actually downloaded/used (not just displayed) — this script
does that automatically — and recommend crediting the photographer. The
manifest.csv this script writes includes the photographer name + Unsplash
profile link + original photo page per image specifically so that credit is
easy to give later if these photos (or anything derived from them) ever get
shown publicly, not just used as opaque training input.
"""
from __future__ import annotations

import sys

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

import argparse
import csv
import time
from pathlib import Path

import requests
from dotenv import load_dotenv
import os

load_dotenv(Path(__file__).parent / ".env")

API_BASE = "https://api.unsplash.com"
DATA_DIR = Path(__file__).parent / "data"

# Multiple queries per category for visual diversity — a single query tends to
# converge on Unsplash's most "aesthetic" results, which skews away from the
# messier, phone-camera-quality photos an actual resale marketplace sees.
CATEGORY_QUERIES = {
    "person": ["portrait photo", "person selfie", "person face closeup", "casual portrait"],
    "building": ["building exterior", "interior design room", "apartment interior", "architecture street"],
    "misc": ["household items", "everyday objects flatlay", "desk objects", "kitchen items"],
    "item": ["handbag product photo", "wristwatch product photo", "sneakers product photo", "jewelry product photo"],
}


def get_access_key() -> str:
    key = os.environ.get("UNSPLASH_ACCESS_KEY")
    if not key:
        raise SystemExit(
            "UNSPLASH_ACCESS_KEY가 설정되지 않았습니다. ml/.env 파일에 "
            "UNSPLASH_ACCESS_KEY=... 를 추가해주세요. (https://unsplash.com/developers)"
        )
    return key


def search_photos(query: str, page: int, access_key: str) -> dict:
    resp = requests.get(
        f"{API_BASE}/search/photos",
        params={"query": query, "page": page, "per_page": 30, "content_filter": "high"},
        headers={"Authorization": f"Client-ID {access_key}"},
        timeout=30,
    )
    remaining = resp.headers.get("X-Ratelimit-Remaining")
    if resp.status_code == 403 and remaining == "0":
        reset_wait = 3600  # Demo apps reset hourly; safest to just wait an hour.
        print(f"    Unsplash API 시간당 호출 한도 도달. {reset_wait // 60}분 대기 후 재시도...")
        time.sleep(reset_wait)
        return search_photos(query, page, access_key)
    resp.raise_for_status()
    if remaining is not None and int(remaining) < 5:
        print(f"    (남은 API 호출 한도: {remaining}회 — 곧 대기 모드로 전환될 수 있음)")
    return resp.json()


def download_photo(url: str, dest: Path) -> None:
    resp = requests.get(url, timeout=60)
    resp.raise_for_status()
    dest.write_bytes(resp.content)


def ping_download_location(download_location: str, access_key: str) -> None:
    """Required by Unsplash API guidelines when a photo is actually used, not just browsed."""
    try:
        requests.get(download_location, headers={"Authorization": f"Client-ID {access_key}"}, timeout=15)
    except requests.RequestException:
        pass  # best-effort — not worth failing the download over


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--per-category", type=int, default=60, help="카테고리당 목표 이미지 수")
    parser.add_argument("--category", choices=list(CATEGORY_QUERIES), help="이 카테고리만 실행 (생략 시 전체)")
    args = parser.parse_args()

    access_key = get_access_key()
    categories = [args.category] if args.category else list(CATEGORY_QUERIES)

    for category in categories:
        out_dir = DATA_DIR / category / "real"
        out_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = out_dir / "manifest.csv"

        existing_ids = set()
        if manifest_path.exists():
            with open(manifest_path, newline="", encoding="utf-8") as f:
                existing_ids = {row["unsplash_id"] for row in csv.DictReader(f)}

        queries = CATEGORY_QUERIES[category]
        target = args.per_category
        per_query_target = max(1, target // len(queries))

        print(f"\n=== {category} — 목표 {target}장 (쿼리 {len(queries)}개 x 약 {per_query_target}장) ===")

        rows: list[dict] = []
        collected = 0
        for query in queries:
            page = 1
            got_for_query = 0
            while got_for_query < per_query_target:
                data = search_photos(query, page, access_key)
                results = data.get("results", [])
                if not results:
                    break
                for photo in results:
                    if got_for_query >= per_query_target:
                        break
                    photo_id = photo["id"]
                    if photo_id in existing_ids:
                        continue
                    filename = f"{photo_id}.jpg"
                    dest = out_dir / filename
                    try:
                        download_photo(photo["urls"]["regular"], dest)
                        ping_download_location(photo["links"]["download_location"], access_key)
                    except requests.RequestException as exc:
                        print(f"    [실패] {photo_id}: {exc}")
                        continue
                    rows.append(
                        {
                            "unsplash_id": photo_id,
                            "filename": filename,
                            "query": query,
                            "photographer": photo["user"]["name"],
                            "photographer_url": photo["user"]["links"]["html"],
                            "photo_page": photo["links"]["html"],
                        }
                    )
                    existing_ids.add(photo_id)
                    got_for_query += 1
                    collected += 1
                page += 1
                if page > data.get("total_pages", 1):
                    break
            print(f"  '{query}': {got_for_query}장 수집")

        if rows:
            write_header = not manifest_path.exists()
            with open(manifest_path, "a", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
                if write_header:
                    writer.writeheader()
                writer.writerows(rows)

        print(f"  {category} 총 {collected}장 신규 수집 (manifest: {manifest_path})")

    print("\n완료. 다음 단계: ml/data/<category>/ai_generated/ 에 AI 생성 이미지를 채운 뒤 extract_embeddings.py 실행.")


if __name__ == "__main__":
    main()
