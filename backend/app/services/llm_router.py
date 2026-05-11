"""Provider selection + the structured-response pipeline.

The original JS routed Anthropic only when `ANTHROPIC_KEY && !OPENAI_KEY`.
We keep that rule so behaviour matches the previous client exactly:
OpenAI is the default; Anthropic is the fallback when no OpenAI key is
configured.
"""

from __future__ import annotations

from fastapi import HTTPException

from ..config import settings
from ..schemas.common import HistoryTurn
from . import anthropic_client, openai_client
from .structured import (
    ParseResult,
    malformed_structured_response,
    validate_structured_text,
)


async def call_structured_response(
    *,
    system: str,
    turns: list[HistoryTurn],
    screenshot_base64: str | None = None,
    temperature: float = 0.85,
) -> ParseResult:
    if not settings.has_openai and not settings.has_anthropic:
        raise HTTPException(
            status_code=503,
            detail=(
                "Neither OPENAI_API_KEY nor ANTHROPIC_API_KEY is configured "
                "on the backend. Set one in backend/.env and restart."
            ),
        )

    use_anthropic = settings.has_anthropic and not settings.has_openai

    try:
        if use_anthropic:
            raw = await anthropic_client.call_messages_structured(
                system=system,
                turns=turns,
                screenshot_base64=screenshot_base64,
            )
        else:
            raw = await openai_client.call_chat_structured(
                system=system,
                turns=turns,
                screenshot_base64=screenshot_base64,
                temperature=temperature,
            )
    except HTTPException:
        # Provider-side errors (4xx/5xx, missing key) bubble up unchanged
        # so the route handler can return them with the right status code.
        raise
    except Exception as err:
        return ParseResult(False, malformed_structured_response(f"API error: {err}"))

    return validate_structured_text(raw)
