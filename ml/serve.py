"""
로컬 추론 서버 — 학습된 linear probe를 실시간 서비스(Next.js)에서 쓰기 위한 것.

왜 이게 필요한가:
    `infer.py`는 실행할 때마다 파이썬 프로세스를 새로 띄우고, 그 안에서
    PyTorch를 import하고 DINOv3 백본을 처음부터 로딩합니다. 이 "콜드 스타트"
    비용이 실측 약 23초입니다 (모델 계산 자체는 순식간인데, 그 앞의 준비
    과정이 대부분의 시간을 잡아먹음). 분석 요청마다 23초씩 걸리는 건 실서비스
    에서 절대 못 씁니다.

    해결책: 모델을 "한 번만" 메모리에 올려두고 계속 떠있는 서버로 만들어서,
    Next.js가 요청마다 새 프로세스를 띄우는 대신 HTTP로 이 서버에 이미지를
    보내기만 하면 되게 만듭니다. 모델 로딩(23초)은 서버 시작할 때 딱 한 번만
    발생하고, 그 이후 요청은 임베딩 추출 + 로지스틱회귀 예측만 하면 되니
    수십~수백 ms 안에 끝납니다.

    이건 실제 ML 서비스에서 아주 흔한 패턴입니다 — "모델 로딩"과 "모델 추론"을
    분리해서, 무거운 로딩은 서버 수명 동안 1회만, 가벼운 추론은 요청마다
    반복하는 구조. Flask/FastAPI로 만들 수도 있지만 외부 의존성을 늘리기
    싫어서 파이썬 표준 라이브러리(http.server)만으로 작성했습니다.

Usage:
    python serve.py                  # http://127.0.0.1:8765 에서 대기
    python serve.py --port 9000

엔드포인트:
    GET  /health  -> {"status": "ok", "embedding_dim": 384}
    POST /infer   -> 요청 바디에 이미지 바이트(raw)를 그대로 담아서 보내면
                     {"ai_probability": 0.0123, "embedding": [384개 float]} 반환
                     (embedding은 Supabase pgvector 저장/유사 이미지 kNN 검색용 —
                     Next.js lib/db/imageRecords.ts 참고)
"""
from __future__ import annotations

import sys

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

import argparse
import json
import os
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import joblib

from backbone import embed_image, embedding_dim

# 서버 시작 시 딱 한 번 채워지는 전역 상태. 요청마다 다시 로드하지 않는 게
# 이 파일 전체의 핵심 포인트입니다.
MODEL = None


class InferHandler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args) -> None:  # noqa: A002 — stdlib 시그니처 그대로
        # 기본 동작은 모든 요청을 콘솔에 한 줄씩 찍는 건데, 시끄러워서 꺼둠.
        # 디버깅할 땐 이 메서드를 지우면 요청 로그가 다시 보입니다.
        pass

    def _respond(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 — http.server가 요구하는 이름
        if self.path == "/health":
            self._respond(200, {"status": "ok", "embedding_dim": embedding_dim()})
        else:
            self._respond(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/infer":
            self._respond(404, {"error": "not found"})
            return

        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length)

        # embed_image()가 파일 경로를 인자로 받는 함수라서(원래 배치 스크립트용
        # 으로 짜여진 함수를 그대로 재사용하기 위해), 받은 바이트를 임시 파일로
        # 한 번 썼다가 그 경로를 넘겨줍니다. 디스크 왕복이 생기지만 몇 ms
        # 수준이라 모델 로딩(23초)에 비하면 무시할 만합니다.
        tmp_path = None
        try:
            fd, tmp_path = tempfile.mkstemp(suffix=".jpg")
            os.close(fd)
            with open(tmp_path, "wb") as f:
                f.write(raw)

            emb = embed_image(tmp_path)
            proba_ai = float(MODEL.predict_proba(emb.reshape(1, -1))[0, 1])
            # Sent alongside the probability so the caller can store it for
            # later kNN similarity search (pgvector) without a second
            # inference pass — embed_image() already computed it, this is
            # just serializing the same array to JSON.
            self._respond(200, {"ai_probability": round(proba_ai, 4), "embedding": emb.tolist()})
        except Exception as exc:  # noqa: BLE001 — 요청 하나 실패로 서버 전체가 죽으면 안 됨
            self._respond(500, {"error": str(exc)})
        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.remove(tmp_path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--model", default=str(Path(__file__).parent / "artifacts" / "linear_probe.joblib"))
    args = parser.parse_args()

    global MODEL
    print(f"linear probe 로딩 중... ({args.model})")
    MODEL = joblib.load(args.model)

    print("DINOv3 백본 워밍업 중 (여기서 ~20초 걸리는 게 정상 — 첫 요청 지연을 여기로 미리 당겨오는 것)...")
    dim = embedding_dim()
    print(f"백본 준비 완료 (embedding_dim={dim})")

    server = ThreadingHTTPServer(("127.0.0.1", args.port), InferHandler)
    print(f"\n추론 서버 실행 중: http://127.0.0.1:{args.port}  (POST /infer, GET /health)")
    print("Next.js .env.local에 IMALYTIX_ENABLE_DINO=true 설정하면 분석 요청마다 이 서버를 호출합니다.")
    print("종료하려면 Ctrl+C\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n서버 종료")


if __name__ == "__main__":
    main()
