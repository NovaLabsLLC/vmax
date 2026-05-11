"""FastAPI entry point — mounts the route modules and CORS, nothing else."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .logging_setup import configure_logging
from .routes import assistant, health, linear, task, voice


def create_app() -> FastAPI:
    configure_logging()
    app = FastAPI(
        title="Vmax backend",
        version="0.1.0",
        description="OpenAI / Anthropic proxy for the Vmax Electron client.",
    )

    # Electron renderer ships from file:// in prod (Origin: null) — allow it
    # alongside the configured localhost origins. Methods/headers are wide
    # open because this binds to 127.0.0.1 by default.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins + ["null"],
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )

    app.include_router(health.router)
    app.include_router(voice.router, prefix="/v1")
    app.include_router(assistant.router, prefix="/v1")
    app.include_router(task.router, prefix="/v1")
    app.include_router(linear.router, prefix="/v1/linear")

    return app


app = create_app()
