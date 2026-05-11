"""Per-route request bodies.

The backend is intentionally repo-agnostic. No request carries a `repo`
field — clients that *do* send one will have it silently dropped because
every model uses `extra="ignore"`. This kept the model from hallucinating
about untracked files when users asked unrelated questions like "hello".
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from .common import HistoryTurn


class TranscribeRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    audio_base64: str = Field(min_length=1)
    mime_type: str | None = None


class TtsRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    text: str = ""
    voice: str = "alloy"


class AskRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    question: str = Field(min_length=1)
    screenshot_base64: str | None = None
    history: list[HistoryTurn] = Field(default_factory=list)


class PlanRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    task: str = ""
    diff: str | None = None
    screenshot_base64: str | None = None


class ExplainFailureRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    task: str = ""
    command: str = ""
    output: str = ""
    screenshot_base64: str | None = None


class SummarizeDiffRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    diff: str = ""
