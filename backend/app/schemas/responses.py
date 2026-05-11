"""Per-route response bodies."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from .common import StructuredResponse


class HealthResponse(BaseModel):
    ok: bool = True


class TranscribeResponse(BaseModel):
    text: str = ""


class TtsResponse(BaseModel):
    audio_base64: str = ""
    mime_type: str = "audio/mpeg"


class StructuredEnvelope(BaseModel):
    """Returned by /v1/ask, /v1/plan, /v1/explain-failure, /v1/summarize-diff.

    `parse_warning` is True when the LLM returned malformed JSON or failed
    schema validation; the client decorates the UI with a small warning
    icon. `structured` is always present (a safe fallback object is
    substituted on parse failure)."""

    model_config = ConfigDict(extra="ignore")

    structured: StructuredResponse
    parse_warning: bool = False
