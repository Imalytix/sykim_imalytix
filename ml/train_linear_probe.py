"""
Step 2 — train a logistic-regression linear probe on top of frozen DINOv2
embeddings. CPU-only, runs in minutes even on thousands of images (the model
is just a weight vector + bias — 385 parameters for DINOv2-small's 384 dims).

Also reports per-category accuracy (개발지시서 2.2절: "카테고리별로 real/AI
비율이 크게 치우치지 않도록... 인물 카테고리 데이터가 부족하면 linear probe가
인물 사진에서만 유독 정확도가 떨어질 수 있다") so a category-specific weakness
shows up immediately instead of being hidden inside one overall accuracy number.

Usage:
    python train_linear_probe.py
    python train_linear_probe.py --artifacts-dir ./artifacts --C 1.0
"""
from __future__ import annotations

import sys

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

import argparse
from pathlib import Path

import joblib
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report
from sklearn.model_selection import train_test_split


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifacts-dir", default=str(Path(__file__).parent / "artifacts"))
    parser.add_argument("--C", type=float, default=1.0, help="로지스틱 회귀 정규화 강도 (역수)")
    parser.add_argument("--test-size", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    artifacts_dir = Path(args.artifacts_dir)
    X = np.load(artifacts_dir / "embeddings.npy")
    y = np.load(artifacts_dir / "labels.npy")
    categories = np.load(artifacts_dir / "categories.npy")

    if len(X) < 20:
        print(f"경고: 학습 데이터가 {len(X)}개뿐입니다. 신뢰할 수 있는 성능 평가에는 부족할 가능성이 큽니다.")

    idx = np.arange(len(X))
    idx_train, idx_val = train_test_split(idx, test_size=args.test_size, stratify=y, random_state=args.seed)

    X_train, X_val = X[idx_train], X[idx_val]
    y_train, y_val = y[idx_train], y[idx_val]
    cat_val = categories[idx_val]

    clf = LogisticRegression(max_iter=1000, C=args.C)
    clf.fit(X_train, y_train)

    y_pred = clf.predict(X_val)

    print("=== 전체 검증 성능 ===")
    print(classification_report(y_val, y_pred, target_names=["real", "ai_generated"]))

    print("=== 카테고리별 정확도 (편차 점검) ===")
    for category in sorted(set(categories.tolist())):
        mask = cat_val == category
        if mask.sum() == 0:
            print(f"  {category:10s}  검증셋에 없음")
            continue
        acc = accuracy_score(y_val[mask], y_pred[mask])
        print(f"  {category:10s}  n={mask.sum():4d}  accuracy={acc:.3f}")

    out_path = artifacts_dir / "linear_probe.joblib"
    joblib.dump(clf, out_path)
    print(f"\n모델 저장 완료 -> {out_path} (배포용 산출물, 수십 KB)")


if __name__ == "__main__":
    main()
