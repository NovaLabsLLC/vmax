"""Async httpx wrapper around Anthropic's messages endpoint."""

from __future__ import annotations

from typing import Any

import httpx
from fastapi import HTTPException

from ..config import settings
from ..schemas.common import HistoryTurn

MESSAGES_URL = "https://api.anthropic.com/v1/messages"
REQUEST_TIMEOUT_S = 60.0


def _require_key() -> str:
    if not settings.has_anthropic:
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY missing on the server. Add it to backend/.env and restart.",
        )
    return settings.anthropic_api_key


async def call_messages_structured(
    *,
    system: str,
    turns: list[HistoryTurn],
    screenshot_base64: str | None,
    max_tokens: int = 2000,
    temperature: float | None = None,
    model: str | None = None,
) -> str:
    """Returns the concatenated text content from the model reply."""
    key = _require_key()
    seq = list(turns)
    messages: list[dict[str, Any]] = []

    for i, turn in enumerate(seq):
        is_last = i == len(seq) - 1
        content: list[dict[str, Any]] = []
        if is_last and turn.role == "user" and screenshot_base64:
            content.append(
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/jpeg",
                        "data": screenshot_base64,
                    },
                }
            )
        suffix = "\n\nReturn ONLY valid JSON." if (is_last and turn.role == "user") else ""
        content.append({"type": "text", "text": turn.text + suffix})
        # Anthropic only knows "user" and "assistant"; the JS client
        # collapsed everything else to "user", so we do too.
        role = "assistant" if turn.role == "assistant" else "user"
        messages.append({"role": role, "content": content})

    body: dict[str, Any] = {
        "model": model or settings.anthropic_model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": messages,
    }
    if temperature is not None:
        body["temperature"] = temperature

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_S) as client:
        res = await client.post(
            MESSAGES_URL,
            headers={
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json=body,
        )
    if res.status_code >= 400:
        raise HTTPException(
            status_code=502, detail=f"Anthropic {res.status_code}: {res.text[:600]}"
        )

    payload = res.json() or {}
    parts = []
    for chunk in payload.get("content") or []:
        text = chunk.get("text") if isinstance(chunk, dict) else None
        if text:
            parts.append(text)
    return "\n".join(parts).strip()


async def call_messages_plaintext(
    *,
    system: str,
    user: str,
    max_tokens: int = 2500,
    temperature: float | None = 0.35,
    model: str | None = None,
) -> str:
    """Text-only replies without forcing JSON on the trailing user turn."""
    key = _require_key()
    messages: list[dict[str, Any]] = [
        {"role": "user", "content": [{"type": "text", "text": user}]},
    ]

    body: dict[str, Any] = {
        "model": model or settings.anthropic_model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": messages,
    }
    if temperature is not None:
        body["temperature"] = temperature

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_S) as client:
        res = await client.post(
            MESSAGES_URL,
            headers={
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json=body,
        )
    if res.status_code >= 400:
        raise HTTPException(
            status_code=502, detail=f"Anthropic {res.status_code}: {res.text[:600]}"
        )

    payload = res.json() or {}
    parts = []
    for chunk in payload.get("content") or []:
        text = chunk.get("text") if isinstance(chunk, dict) else None
        if text:
            parts.append(text)
    return "\n".join(parts).strip()
