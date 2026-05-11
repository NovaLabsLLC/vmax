"""Parse + validate the LLM's JSON reply into a StructuredResponse.

Mirrors validateStructuredResponse + parseJSON + malformedStructuredResponse
from the JS client. The client never throws past this layer: malformed
output becomes a `ParseResult(ok=False, data=<safe fallback>)` so the
caller can still render *something*.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

from pydantic import ValidationError

from ..schemas.common import StructuredResponse

_FENCED = re.compile(r"```(?:json)?\s*([\s\S]*?)```")


@dataclass(frozen=True)
class ParseResult:
    ok: bool
    data: StructuredResponse


def malformed_structured_response(hint: str) -> StructuredResponse:
    detail = re.sub(r"[\u0000-\u001f]", " ", str(hint or "unknown"))[:280]
    return StructuredResponse(
        summary=(
            "Vmax could not parse the model reply \u2014 it was missing "
            "fields or not valid JSON. Nothing was executed; you can try "
            "again."
        ),
        what_vmax_sees="",
        likely_problem=detail,
        next_steps=[
            f"Error from model: {detail}",
            "Retry with a shorter task or question",
            "Confirm API keys in .env and network access",
        ],
        cursor_prompt="",
        claude_prompt="",
        suggested_commands=[],
        execution_recommendation="none",
        speakable_summary=(
            "I couldn't parse that reply \u2014 nothing ran. Try a shorter "
            "question or check your API keys, then ask again."
        ),
    )


def _parse_json(raw: str) -> dict:
    if not raw:
        raise ValueError("empty AI response")

    fenced = _FENCED.search(raw)
    body = fenced.group(1) if fenced else raw

    try:
        return json.loads(body)
    except json.JSONDecodeError:
        # The model occasionally wraps JSON in prose. Pull the outermost
        # {...} and try once more.
        start = body.find("{")
        end = body.rfind("}")
        if 0 <= start < end:
            return json.loads(body[start : end + 1])
        snippet = body[:200]
        raise ValueError(f"AI returned non-JSON: {snippet}")


def validate_structured_text(raw: str) -> ParseResult:
    """Best-effort: parse + Pydantic-validate. Never raises."""
    try:
        obj = _parse_json(raw)
    except ValueError as err:
        return ParseResult(False, malformed_structured_response(f"Invalid JSON: {err}"))

    try:
        return ParseResult(True, StructuredResponse.model_validate(obj))
    except ValidationError as err:
        # Compress Pydantic errors into a single line, as the JS side does.
        bits: list[str] = []
        for issue in err.errors():
            loc = ".".join(str(p) for p in issue.get("loc", ())) or "root"
            bits.append(f"{loc}: {issue.get('msg', 'invalid')}")
        return ParseResult(False, malformed_structured_response("; ".join(bits)))
