"""Whisper transcription + OpenAI TTS endpoints."""

from __future__ import annotations

import base64

from fastapi import APIRouter

from ..logging_setup import log_audit
from ..schemas.requests import TranscribeRequest, TtsRequest
from ..schemas.responses import TranscribeResponse, TtsResponse
from ..services import openai_client

router = APIRouter()


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(body: TranscribeRequest) -> TranscribeResponse:
    text = await openai_client.transcribe(body.audio_base64, body.mime_type)
    log_audit(
        "transcribe",
        mime_type=body.mime_type or "",
        audio_base64_chars=len(body.audio_base64 or ""),
        text=text,
        text_chars=len(text or ""),
    )
    return TranscribeResponse(text=text)


@router.post("/tts", response_model=TtsResponse)
async def tts(body: TtsRequest) -> TtsResponse:
    raw = await openai_client.synthesize_speech(body.text, body.voice)
    audio_b64 = base64.b64encode(raw).decode("ascii")
    log_audit(
        "tts",
        voice=body.voice,
        text=body.text,
        text_chars=len(body.text or ""),
        audio_bytes=len(raw),
    )
    return TtsResponse(audio_base64=audio_b64, mime_type="audio/mpeg")
