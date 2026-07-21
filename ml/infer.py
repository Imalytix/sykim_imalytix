"""
Step 3 — run the trained linear probe on a new image.

Usage:
    python infer.py path/to/image.jpg
    python infer.py path/to/image.jpg --model ./artifacts/linear_probe.joblib
"""
from __future__ import annotations

import sys

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

import argparse
import json
from pathlib import Path

import joblib

from backbone import embed_image


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("image_path")
    parser.add_argument("--model", default=str(Path(__file__).parent / "artifacts" / "linear_probe.joblib"))
    args = parser.parse_args()

    clf = joblib.load(args.model)
    emb = embed_image(args.image_path)
    proba_ai = float(clf.predict_proba(emb.reshape(1, -1))[0, 1])

    print(json.dumps({"image": args.image_path, "ai_probability": round(proba_ai, 4)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
