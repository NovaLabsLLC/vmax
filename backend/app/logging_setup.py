"""Audit logging for the user-visible routes (/v1/ask, /v1/tts).

Every audit call produces two artifacts:

  1. A pretty single-line message on stdout, so it shows up live in the
     uvicorn console while you use the app.
  2. A JSON line appended to ``backend/logs/audit.log``, so you can grep
     or replay sessions later.

The log filename ends in ``.log`` so the repo-level ``*.log`` gitignore
keeps it out of git. The directory is created on demand.

This module is intentionally tiny and dependency-free (stdlib only) so
it never becomes the reason a request fails.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_AUDIT_LOGGER_NAME = "vmax.audit"
_JSONL_LOGGER_NAME = "vmax.audit.jsonl"
_LOG_DIR = Path(__file__).resolve().parent.parent / "logs"
_LOG_FILE = _LOG_DIR / "audit.log"

_configured = False


def configure_logging() -> None:
    """Wire up stdout + JSONL handlers. Idempotent — uvicorn ``--reload``
    re-imports modules and we don't want stacked handlers."""
    global _configured
    if _configured:
        return

    root = logging.getLogger()
    if not root.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s  %(name)s  %(message)s"))
        root.addHandler(handler)
    if root.level > logging.INFO or root.level == logging.NOTSET:
        root.setLevel(logging.INFO)

    audit = logging.getLogger(_AUDIT_LOGGER_NAME)
    audit.setLevel(logging.INFO)
    audit.propagate = True  # let root print the pretty line to stdout

    jsonl = logging.getLogger(_JSONL_LOGGER_NAME)
    jsonl.setLevel(logging.INFO)
    jsonl.propagate = False  # never leak raw JSON to stdout
    if not jsonl.handlers:
        try:
            _LOG_DIR.mkdir(parents=True, exist_ok=True)
            file_handler = logging.FileHandler(_LOG_FILE, encoding="utf-8")
            file_handler.setFormatter(logging.Formatter("%(message)s"))
            jsonl.addHandler(file_handler)
        except OSError as err:
            # Read-only mount or perms issue — keep stdout logging working.
            logging.getLogger(__name__).warning(
                "audit jsonl file disabled (%s): %s", _LOG_FILE, err
            )

    _configured = True


def log_audit(event: str, **fields: Any) -> None:
    """Emit one audit record. ``event`` is e.g. ``"ask"`` or ``"tts"``.

    Never raises — logging must not break the request path."""
    try:
        ts = datetime.now(timezone.utc).isoformat(timespec="seconds")
        pretty = " | ".join(f"{k}={_format_field(v)}" for k, v in fields.items())
        logging.getLogger(_AUDIT_LOGGER_NAME).info("[audit] %s | %s", event, pretty)

        record: dict[str, Any] = {"ts": ts, "event": event}
        record.update(fields)
        logging.getLogger(_JSONL_LOGGER_NAME).info(
            json.dumps(record, ensure_ascii=False, default=str)
        )
    except Exception:
        pass


def _format_field(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        flat = value.replace("\n", " ").strip()
        if len(flat) > 160:
            flat = flat[:160] + "\u2026"
        return f"\"{flat}\""
    return str(value)
