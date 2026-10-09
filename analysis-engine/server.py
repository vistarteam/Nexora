#!/usr/bin/env python3
"""Optional HTTP wrapper around the analysis engine.

The Node backend spawns `cli.py` as a subprocess, which needs no ports and no
extra dependencies. This server exists for two cases:

  * running the engine as a standalone service (containers, queues, another
    language's backend), and
  * manual exploration with curl.

Only the Python standard library is used.

    python server.py --port 8000

Endpoints:
    GET  /health   -> {"ok": true, "engine": {...}}
    POST /analyze  -> body is the same JSON payload `cli.py` reads
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from nexora_analysis import ENGINE_NAME, ENGINE_VERSION, EngineInputError, analyze  # noqa: E402

MAX_BODY_BYTES = 8 * 1024 * 1024


def _engine_info() -> dict[str, str]:
    return {"id": "python", "name": ENGINE_NAME, "version": ENGINE_VERSION}


class Handler(BaseHTTPRequestHandler):
    server_version = f"NexoraAnalysis/{ENGINE_VERSION}"

    def _send(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        if self.path.split("?")[0] in ("/health", "/"):
            self._send(200, {"ok": True, "engine": _engine_info()})
        else:
            self._send(404, {"ok": False, "error": {"code": "NOT_FOUND", "message": "مسیر یافت نشد."}})

    def do_POST(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        if self.path.split("?")[0] != "/analyze":
            self._send(404, {"ok": False, "error": {"code": "NOT_FOUND", "message": "مسیر یافت نشد."}})
            return

        length = int(self.headers.get("content-length") or 0)
        if length <= 0:
            self._send(
                400,
                {"ok": False, "error": {"code": "BAD_REQUEST", "message": "بدنه درخواست خالی است."}},
            )
            return
        if length > MAX_BODY_BYTES:
            self._send(
                413,
                {
                    "ok": False,
                    "error": {"code": "PAYLOAD_TOO_LARGE", "message": "بدنه درخواست بیش از حد بزرگ است."},
                },
            )
            return

        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            self._send(
                400,
                {"ok": False, "error": {"code": "VALIDATION_ERROR", "message": f"JSON نامعتبر: {error}"}},
            )
            return

        try:
            result = analyze(payload)
        except EngineInputError as error:
            self._send(
                400,
                {"ok": False, "error": {"code": "VALIDATION_ERROR", "message": str(error)}},
            )
            return

        self._send(200, {"ok": True, "data": result})

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write(f"[analysis-engine] {fmt % args}\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="NEXORA analysis engine HTTP server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(
        f"NEXORA analysis engine {ENGINE_VERSION} listening on http://{args.host}:{args.port}",
        file=sys.stderr,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
