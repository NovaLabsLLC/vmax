"""Async httpx wrappers around OpenAI's chat / Whisper / TTS endpoints.

Matches the JS client (utils/aiClient.js) wire-for-wire: same temperature,
same max_tokens, same screenshot attachment shape. Don't 'modernize' these
without checking the prompts still validate."""

from __future__ import annotations

import base64
from typing import Any

import httpx
from fastapi import HTTPException

from ..config import settings
from ..schemas.common import HistoryTurn

CHAT_URL = "https://api.openai.com/v1/chat/completions"
WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions"
TTS_URL = "https://api.openai.com/v1/audio/speech"

REQUEST_TIMEOUT_S = 60.0


def _require_key() -> str:
    if not settings.has_openai:
        raise HTTPException(
            status_code=503,
            detail="OPENAI_API_KEY missing on the server. Add it to backend/.env and restart.",
        )
    return settings.openai_api_key


def _attach_screenshot(text: str, screenshot_base64: str) -> list[dict[str, Any]]:
    return [
        {
            "type": "text",
            "text": (
                f"{text}\n\n(A screenshot of the user's screen is attached. "
                "Reference visible UI when relevant.)"
            ),
        },
        {
            "type": "image_url",
            "image_url": {
                "url": f"data:image/jpeg;base64,{screenshot_base64}",
                "detail": "low",
            },
        },
    ]


async def call_chat_structured(
    *,
    system: str,
    turns: list[HistoryTurn],
    screenshot_base64: str | None,
    temperature: float = 0.85,
    max_tokens: int = 1800,
    model: str | None = None,
) -> str:
    """Returns the raw model text. Caller must json-parse + validate.

    `model` defaults to the structured-response model; the task planner
    overrides it with the cheaper/faster `openai_model_task` variant.
    """
    key = _require_key()
    seq = list(turns)
    msgs: list[dict[str, Any]] = [{"role": "system", "content": system}]

    for i, turn in enumerate(seq):
        is_last = i == len(seq) - 1
        if is_last and turn.role == "user" and screenshot_base64:
            msgs.append(
                {"role": "user", "content": _attach_screenshot(turn.text, screenshot_base64)}
            )
        else:
            msgs.append({"role": turn.role, "content": turn.text})

    body = {
        "model": model or settings.openai_model,
        "messages": msgs,
        "response_format": {"type": "json_object"},
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_S) as client:
        res = await client.post(
            CHAT_URL,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json=body,
        )
    if res.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"OpenAI {res.status_code}: {res.text[:600]}")

    payload = res.json()
    choices = payload.get("choices") or []
    if not choices:
        return ""
    return ((choices[0].get("message") or {}).get("content") or "").strip()


async def call_chat_plaintext(
    *,
    system: str,
    user: str,
    temperature: float = 0.35,
    max_tokens: int = 2500,
    model: str | None = None,
) -> str:
    """One-shot Markdown / prose replies (no ``response_format: json_object``)."""
    key = _require_key()
    msgs: list[dict[str, Any]] = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]

    body = {
        "model": model or settings.openai_model,
        "messages": msgs,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_S) as client:
        res = await client.post(
            CHAT_URL,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json=body,
        )
    if res.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"OpenAI {res.status_code}: {res.text[:600]}")

    payload = res.json()
    choices = payload.get("choices") or []
    if not choices:
        return ""
    return ((choices[0].get("message") or {}).get("content") or "").strip()


async def transcribe(audio_base64: str, mime_type: str | None) -> str:
    key = _require_key()
    raw = base64.b64decode(audio_base64)
    ext = "wav" if (mime_type and "wav" in mime_type) else "webm"
    files = {"file": (f"audio.{ext}", raw, mime_type or "audio/webm")}
    data = {"model": "whisper-1"}

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_S) as client:
        res = await client.post(
            WHISPER_URL,
            headers={"Authorization": f"Bearer {key}"},
            files=files,
            data=data,
        )
    if res.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Whisper {res.status_code}: {res.text[:600]}")
    return (res.json() or {}).get("text", "") or ""


async def synthesize_speech(text: str, voice: str = "alloy") -> bytes:
    """Returns raw mp3 bytes. tts-1 is the low-latency model; speed=1.15
    matches the JS client (brisk delivery without sounding sped up)."""
    key = _require_key()
    body = {
        "model": "tts-1",
        "voice": voice,
        "input": (text or "")[:4000],
        "speed": 1.15,
        "response_format": "mp3",
    }
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_S) as client:
        res = await client.post(
            TTS_URL,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json=body,
        )
    if res.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"TTS {res.status_code}: {res.text[:600]}")
    return res.content
