"""Centralised env loading. Reads .env once at import; everything else
asks `settings` rather than touching os.environ directly."""

from __future__ import annotations

import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

load_dotenv()


def _split_csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    openai_api_key: str = ""
    anthropic_api_key: str = ""

    # Defaults match the previous Electron client so behaviour doesn't drift.
    openai_model: str = "gpt-4o-mini"
    openai_model_text: str = "gpt-4o-mini"
    anthropic_model: str = "claude-sonnet-4-6"

    # Task planner uses the cheapest/fastest variants — kept on a separate
    # knob from the structured-response models so we can downgrade /v1/task
    # latency without touching /v1/ask quality.
    openai_model_task: str = "gpt-4o-mini"
    anthropic_model_task: str = "claude-haiku-4-5-20251001"

    host: str = "127.0.0.1"
    port: int = 8000

    allowed_origins: list[str] = field(default_factory=list)

    @property
    def has_openai(self) -> bool:
        return bool(self.openai_api_key)

    @property
    def has_anthropic(self) -> bool:
        return bool(self.anthropic_api_key)


def _load() -> Settings:
    origins = _split_csv(os.environ.get("VMAX_ALLOWED_ORIGINS"))
    if not origins:
        # The Electron renderer runs from file:// in prod (Origin: null) and
        # from the Vite dev server in dev. We default to permissive localhost
        # origins; production deployment should set VMAX_ALLOWED_ORIGINS.
        origins = [
            "http://localhost:5180",
            "http://127.0.0.1:5180",
            "http://localhost:5181",
            "http://127.0.0.1:5181",
        ]

    try:
        port = int(os.environ.get("VMAX_PORT", "8000"))
    except ValueError:
        port = 8000

    return Settings(
        openai_api_key=os.environ.get("OPENAI_API_KEY", "").strip(),
        anthropic_api_key=os.environ.get("ANTHROPIC_API_KEY", "").strip(),
        openai_model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini",
        openai_model_text=os.environ.get("OPENAI_MODEL_TEXT", "").strip() or "",
        anthropic_model=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6").strip() or "claude-sonnet-4-6",
        openai_model_task=(
            os.environ.get("OPENAI_MODEL_TASK", "gpt-4o-mini").strip() or "gpt-4o-mini"
        ),
        anthropic_model_task=(
            os.environ.get("ANTHROPIC_MODEL_TASK", "claude-haiku-4-5-20251001").strip()
            or "claude-haiku-4-5-20251001"
        ),
        host=os.environ.get("VMAX_HOST", "127.0.0.1").strip() or "127.0.0.1",
        port=port,
        allowed_origins=origins,
    )


settings = _load()
