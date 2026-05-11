"""Liveness / config probe."""

from __future__ import annotations

from fastapi import APIRouter

from ..config import settings
from ..schemas.responses import HealthResponse

router = APIRouter()


@router.get("/healthz", response_model=HealthResponse)
def healthz() -> HealthResponse:
    return HealthResponse(ok=True)


@router.get("/v1/info")
def info() -> dict:
    """Surface what the server can do without leaking the actual keys.
    Useful for the Electron client to decide whether to enable voice."""
    return {
        "openai": settings.has_openai,
        "anthropic": settings.has_anthropic,
        "models": {
            "openai": settings.openai_model,
            "anthropic": settings.anthropic_model,
        },
    }
