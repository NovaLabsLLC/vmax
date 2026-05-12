"""Vision-assisted Linear issue drafts (title + description) from a screenshot."""

from __future__ import annotations

import base64
import binascii
import json
import re

from fastapi import HTTPException
from openai import AsyncOpenAI

from ..config import settings
from ..schemas.common import HistoryTurn
from . import anthropic_client

MAX_IMAGE_B64_CHARS = 8_000_000
_MIN_PAYLOAD_CHARS = 100
_MAX_TITLE_LEN = 240
_MAX_DESCRIPTION_LEN = 32_000

_JSON_FENCE = re.compile(r"```(?:json)?\s*([\s\S]*?)```")
_VISION_IMAGE_MIME = frozenset(
    {"image/jpeg", "image/png", "image/gif", "image/webp"},
)


_ISSUE_DRAFT_USER_PROMPT = """
You are creating a Linear issue from a screenshot.

Look carefully at the image and infer the actual engineering task. Prefer concrete bugs,
missing behaviour, regressions, or implementation work suggested by UI, logs, mocks,
diagrams on a whiteboard, or error messages—not generic placeholders.

Return ONLY valid JSON with this exact shape (no prose outside the JSON):
{
  "title": "...",
  "description": "..."
}

Rules for title:
- Short, specific, and action-oriented (what to build or fix).
- No vague titles like “Fix bug” or “Improve X” unless the image truly gives no specifics.

Rules for description (Markdown allowed):
- **Context**: What is visible in the screenshot (product area, screens, identifiers if shown).
- **Problem / gap**: What seems broken, missing, or unclear (expected vs observed when inferable).
- **Proposed implementation** (bullet list OK): Practical steps another engineer could take.
- **Acceptance criteria**: Explicit checklist-style bullets the assignee must satisfy before closing.
- If the screenshot is ambiguous, spell out assumptions and exactly what needs confirmation before work starts.
- Do not invent repo paths, filenames, endpoint URLs, ticket IDs, or stack traces unless those strings are visible in the image.
- Prefer ASCII unless the image shows non‑English UI text worth preserving.
"""


_openai_async: AsyncOpenAI | None = None


def _get_async_openai() -> AsyncOpenAI:
    global _openai_async
    if _openai_async is None:
        if not settings.has_openai:
            raise RuntimeError("OpenAI key missing")
        _openai_async = AsyncOpenAI(api_key=settings.openai_api_key)
    return _openai_async


def normalize_and_validate_base64_image(raw: str) -> tuple[str, str]:
    """Strip whitespace and optional ``data-url`` prefix; return ``(pure_base64, media_type_hint)``.

    ``media_type_hint`` is a MIME type usable in ``data:image/...`` or Anthropic vision payloads.
    """
    s = (raw or "").strip()
    if s.startswith("data:"):
        comma = s.find(",")
        if comma >= 0:
            s = s[comma + 1 :]

    s = "".join(s.split())
    if len(s) < _MIN_PAYLOAD_CHARS:
        raise HTTPException(status_code=400, detail="Missing or invalid image.")
    if len(s) > MAX_IMAGE_B64_CHARS:
        raise HTTPException(status_code=413, detail="Image is too large.")

    try:
        decoded = base64.b64decode(s, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="Image base64 is invalid.") from None

    if decoded.startswith(b"\xff\xd8\xff"):
        return s, "image/jpeg"
    if decoded.startswith(b"\x89PNG\r\n\x1a\n"):
        return s, "image/png"
    if decoded.startswith((b"GIF87a", b"GIF89a")):
        return s, "image/gif"
    if decoded.startswith(b"RIFF") and decoded[8:12] == b"WEBP":
        return s, "image/webp"

    raise HTTPException(
        status_code=400,
        detail="Image bytes are not a supported format (JPEG, PNG, GIF, or WebP).",
    )


def _parse_relaxed_json(text: str) -> dict[str, object]:
    cleaned = (text or "").strip()
    if not cleaned:
        raise ValueError("empty model reply")

    fenced = _JSON_FENCE.search(cleaned)
    body = fenced.group(1) if fenced else cleaned
    try:
        parsed = json.loads(body)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        pass

    start = body.find("{")
    end = body.rfind("}")
    if 0 <= start < end:
        parsed = json.loads(body[start : end + 1])
        return parsed if isinstance(parsed, dict) else {}

    raise json.JSONDecodeError("no JSON object", body, 0)


def _coerce_title_description(data: dict[str, object]) -> tuple[str, str]:
    title = str(data.get("title", "")).strip()
    description = str(data.get("description", "")).strip()
    if not title or not description:
        raise HTTPException(status_code=502, detail="LLM did not produce a valid issue draft.")
    title = title[:_MAX_TITLE_LEN]
    description = description[:_MAX_DESCRIPTION_LEN]
    return title, description


async def _draft_with_openai_vision(*, image_base64: str, media_type: str) -> dict[str, str]:
    mime = media_type if media_type in _VISION_IMAGE_MIME else "image/jpeg"

    resp = await _get_async_openai().chat.completions.create(
        model=settings.vision_issue_model,
        temperature=0.2,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": _ISSUE_DRAFT_USER_PROMPT},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime};base64,{image_base64}"},
                    },
                ],
            }
        ],
        response_format={"type": "json_object"},
    )

    raw = resp.choices[0].message.content or "{}"

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as err:
        raise HTTPException(status_code=502, detail="LLM returned invalid JSON.") from err

    if not isinstance(data, dict):
        raise HTTPException(status_code=502, detail="LLM returned invalid JSON.")

    title, description = _coerce_title_description(data)
    return {"title": title, "description": description}


async def _draft_with_anthropic_vision(*, image_base64: str, media_type: str) -> dict[str, str]:
    effective_mime = media_type if media_type in _VISION_IMAGE_MIME else "image/jpeg"

    system = (
        "You draft Linear issues from screenshots for software teams. Reply with "
        'one JSON object only: keys exactly "title" and "description" (both non-empty '
        "strings when there is actionable work)."
    )

    raw = await anthropic_client.call_messages_structured(
        system=system,
        turns=[HistoryTurn(role="user", text=_ISSUE_DRAFT_USER_PROMPT)],
        screenshot_base64=image_base64,
        screenshot_media_type=effective_mime,
        max_tokens=1800,
        temperature=0.2,
    )

    try:
        data = _parse_relaxed_json(raw)
    except (json.JSONDecodeError, ValueError) as err:
        raise HTTPException(
            status_code=502,
            detail=f"Issue draft model returned malformed JSON: {err}",
        ) from err

    title, description = _coerce_title_description(data)
    return {"title": title, "description": description}


async def draft_issue_from_image(*, image_base64: str) -> dict[str, str]:
    """Validate base64 screenshot and return ``title`` + ``description`` for Linear."""

    pure_b64, media_type = normalize_and_validate_base64_image(image_base64)

    if not settings.has_openai and not settings.has_anthropic:
        raise HTTPException(
            status_code=503,
            detail=(
                "Neither OPENAI_API_KEY nor ANTHROPIC_API_KEY is configured "
                "on the backend. Set one in backend/.env and restart."
            ),
        )

    prefer_anthropic = settings.has_anthropic and not settings.has_openai

    try:
        if prefer_anthropic:
            return await _draft_with_anthropic_vision(
                image_base64=pure_b64,
                media_type=media_type,
            )
        return await _draft_with_openai_vision(
            image_base64=pure_b64,
            media_type=media_type,
        )
    except HTTPException:
        raise
    except RuntimeError:
        raise HTTPException(
            status_code=503,
            detail=(
                "OpenAI credentials are unavailable. Set OPENAI_API_KEY "
                "or configure ANTHROPIC_API_KEY for vision drafting."
            ),
        ) from None
