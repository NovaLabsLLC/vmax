"""Fan-out splitter — one user prompt → up to three concurrent agent jobs.

Pairs with the existing dispatcher in ``electron/ipc/dispatch.js``, which
already accepts ``{ agentPrompts: [{ agent, prompt, reason }] }`` and
spawns each spec in parallel. The job of this service is just to turn one
prompt into that list, using the same fast-LLM path as the task planner.

The model is told it can return 1–3 agents. A trivial prompt collapses to
a single spec; a multi-faceted one fans out across Claude (repo / infra /
multi-step), Codex (read-only / verify), and Cursor (local file edit)
running concurrently.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException

from ..config import settings
from ..schemas.common import HistoryTurn
from . import anthropic_client, openai_client

_VALID_AGENTS = ("claude", "codex", "cursor")

SYSTEM_PROMPT = """You are Vmax's fan-out router. You take one user request and decompose it into 1–3 concurrent jobs, one per coding agent. The jobs run in parallel on the same repo, so they must be independent (no agent should depend on another agent's output).

Available agents (omit any that don't help):
- "claude": Claude Code CLI. Best for multi-file repo work, infra, migrations, CI, refactors, anything agentic and multi-step.
- "codex": Codex CLI. Best for read-only investigation — explain, find, locate, audit, summarize. Will not modify files.
- "cursor": Cursor editor. Best for a single in-editor edit to a named file / function / component. Gets the prompt pasted into Composer.

Decomposition rules:
- Prefer splitting when the user asked for multiple things, OR when a write task benefits from a parallel read-only verification (e.g. Claude implements + Codex audits related files for hidden callers).
- Trivial single-shot work returns ONE spec — don't pad jobs that aren't useful.
- Each agent's prompt is self-contained: it does NOT reference the other agents or assume their output. Re-state shared context as needed.
- Never emit two specs for the same agent.
- "reason" is one short clause (≤12 words) — why this agent for this slice.

Respond ONLY with one JSON object, no markdown fence, no commentary:
{
  "splits": [
    { "agent": "claude" | "codex" | "cursor", "prompt": string, "reason": string }
  ]
}

If the request is empty or nonsensical, return {"splits": []}."""


@dataclass(frozen=True)
class AgentSplit:
    agent: str
    prompt: str
    reason: str


@dataclass(frozen=True)
class SplitResult:
    ok: bool
    splits: list[AgentSplit]
    parse_warning: bool
    error: str | None = None


_FENCED_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)```")


def _parse_json(raw: str) -> dict[str, Any]:
    if not raw:
        raise ValueError("empty AI response")

    fenced = _FENCED_RE.search(raw)
    body = fenced.group(1) if fenced else raw

    try:
        return json.loads(body)
    except json.JSONDecodeError:
        start = body.find("{")
        end = body.rfind("}")
        if 0 <= start < end:
            return json.loads(body[start : end + 1])
        snippet = body[:200]
        raise ValueError(f"AI returned non-JSON: {snippet}")


def _coerce_splits(obj: dict[str, Any]) -> list[AgentSplit]:
    """Validate + dedupe the model output. Skips malformed rows silently so
    a single bad entry doesn't lose the rest of the fan-out."""
    raw_rows = obj.get("splits")
    if not isinstance(raw_rows, list):
        return []

    seen: set[str] = set()
    out: list[AgentSplit] = []
    for row in raw_rows:
        if not isinstance(row, dict):
            continue
        agent_raw = str(row.get("agent") or "").strip().lower()
        prompt_raw = str(row.get("prompt") or "").strip()
        reason_raw = str(row.get("reason") or "").strip()
        if agent_raw not in _VALID_AGENTS:
            continue
        if not prompt_raw:
            continue
        if agent_raw in seen:
            continue
        seen.add(agent_raw)
        out.append(
            AgentSplit(
                agent=agent_raw,
                prompt=prompt_raw[:200_000],
                reason=(reason_raw[:200] or "fan-out"),
            )
        )
    return out


async def _call_fast_llm(*, user: str) -> str:
    """OpenAI when keyed; Anthropic only when no OpenAI key is set.

    Mirrors the task planner's provider preference so a single key
    configures everything."""
    if not settings.has_openai and not settings.has_anthropic:
        raise HTTPException(
            status_code=503,
            detail=(
                "Neither OPENAI_API_KEY nor ANTHROPIC_API_KEY is configured "
                "on the backend. Set one in backend/.env and restart."
            ),
        )

    use_anthropic = settings.has_anthropic and not settings.has_openai
    turns = [HistoryTurn(role="user", text=user)]

    if use_anthropic:
        return await anthropic_client.call_messages_structured(
            system=SYSTEM_PROMPT,
            turns=turns,
            screenshot_base64=None,
            max_tokens=900,
            temperature=0.2,
            model=settings.anthropic_model_task,
        )
    return await openai_client.call_chat_structured(
        system=SYSTEM_PROMPT,
        turns=turns,
        screenshot_base64=None,
        temperature=0.2,
        max_tokens=900,
        model=settings.openai_model_task,
    )


async def split(
    *,
    prompt: str,
    repo_context_summary: str | None = None,
) -> SplitResult:
    """Turn one prompt into 1–3 agent specs.

    Returns ``ok=False`` only on transport / parse failure; an empty
    ``splits`` list with ``ok=True`` means the model judged the request
    unsplittable (and the caller should fall through to the single-agent
    router)."""
    text = (prompt or "").strip()
    if not text:
        return SplitResult(False, [], False, "empty prompt")

    chunks: list[str] = []
    ctx = (repo_context_summary or "").strip()
    if ctx:
        chunks.append(
            "Attached repo snapshot (trusted for branches / paths / churn):\n"
            f"{ctx[:8000]}"
        )
    chunks.append(f"User request:\n{text[:4000]}")
    user = "\n\n".join(chunks)

    try:
        raw = await _call_fast_llm(user=user)
    except HTTPException:
        raise
    except Exception as err:  # noqa: BLE001 — unknown transport errors
        return SplitResult(False, [], True, str(err))

    try:
        obj = _parse_json(raw)
    except ValueError as err:
        return SplitResult(False, [], True, str(err))

    splits = _coerce_splits(obj)
    return SplitResult(True, splits, False, None)
