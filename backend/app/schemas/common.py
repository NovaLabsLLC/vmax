"""Shared schemas: structured LLM response + history turns.

These mirror the JS Zod schema in utils/aiResponseSchema.js so the wire
format is stable across both ends of the IPC boundary.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class StructuredResponse(BaseModel):
    """The single JSON shape every assistant prompt asks the LLM to emit."""

    model_config = ConfigDict(extra="ignore")

    summary: str = ""
    what_vmax_sees: str = ""
    likely_problem: str = ""
    next_steps: list[str] = Field(default_factory=list)
    cursor_prompt: str = ""
    claude_prompt: str = ""
    suggested_commands: list[str] = Field(default_factory=list)
    execution_recommendation: str = "none"
    speakable_summary: str = ""


class HistoryTurn(BaseModel):
    """One prior turn in an /v1/ask conversation."""

    model_config = ConfigDict(extra="ignore")

    role: Literal["user", "assistant"]
    text: str
