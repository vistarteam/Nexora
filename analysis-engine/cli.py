#!/usr/bin/env python3
"""Command-line entry point for the NEXORA analysis engine.

Reads one JSON payload from stdin and writes one JSON result to stdout. This is
the interface the Node backend spawns; it is also convenient for manual checks:

    echo '{"symbol":"X","timeframe":"1h","candles":[...]}' | python cli.py

Contract:
  * stdin  : {"symbol": str, "timeframe": str, "candles": [OHLCV...], "options": {...}}
  * stdout : {"engine": {...}, "status": "ok"|"insufficient_data"|"unavailable", ...}
  * exit 0 : the payload was processed (even when the status is not "ok")
  * exit 2 : the input could not be parsed at all

Output is always UTF-8 with non-ASCII characters preserved, because every
user-facing string is Persian. `ensure_ascii=True` would also work but makes
logs unreadable.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any

# Make `python cli.py` work from any working directory.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from nexora_analysis import ENGINE_NAME, ENGINE_VERSION, EngineInputError, analyze  # noqa: E402


def _read_stdin() -> str:
    # Never rely on the platform default encoding: on Windows it may be cp1256,
    # which cannot round-trip the Persian strings in the payload.
    raw = sys.stdin.buffer.read()
    return raw.decode("utf-8", errors="replace")


def _write_stdout(payload: dict[str, Any]) -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()


def main() -> int:
    text = _read_stdin().strip()
    if not text:
        _write_stdout(
            {
                "engine": {"id": "python", "name": ENGINE_NAME, "version": ENGINE_VERSION},
                "status": "unavailable",
                "facts": None,
                "interpretation": None,
                "scenarios": [],
                "warnings": [],
                "reason": "هیچ ورودی روی stdin دریافت نشد.",
            }
        )
        return 0

    try:
        payload = json.loads(text)
    except json.JSONDecodeError as error:
        _write_stdout(
            {
                "engine": {"id": "python", "name": ENGINE_NAME, "version": ENGINE_VERSION},
                "status": "unavailable",
                "facts": None,
                "interpretation": None,
                "scenarios": [],
                "warnings": [],
                "reason": f"ورودی JSON نامعتبر است: {error.msg} (خط {error.lineno})",
            }
        )
        return 2

    try:
        result = analyze(payload)
    except EngineInputError as error:
        _write_stdout(
            {
                "engine": {"id": "python", "name": ENGINE_NAME, "version": ENGINE_VERSION},
                "status": "unavailable",
                "facts": None,
                "interpretation": None,
                "scenarios": [],
                "warnings": [],
                "reason": f"ساختار ورودی نامعتبر است: {error}",
            }
        )
        return 2
    except Exception as error:  # pragma: no cover - defensive, reported to caller
        _write_stdout(
            {
                "engine": {"id": "python", "name": ENGINE_NAME, "version": ENGINE_VERSION},
                "status": "unavailable",
                "facts": None,
                "interpretation": None,
                "scenarios": [],
                "warnings": [],
                "reason": f"خطای غیرمنتظره در موتور تحلیل: {type(error).__name__}: {error}",
            }
        )
        return 1

    _write_stdout(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
