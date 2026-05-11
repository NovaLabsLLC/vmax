"""Vmax task planner — turns a freeform user prompt into a strict VmaxTask.

Ported from utils/taskSchema.js. Same prompt, same fallback, same shape.
The renderer renders the result as "Task ready: …  Approve?", so the
contract has to stay 1:1 with the JS Zod schema.

Budget: 500ms-2s end-to-end. We use the cheapest/fastest model variants
(`openai_model_task` / `anthropic_model_task`), low max_tokens, and skip
screenshots / diffs.
"""

from __future__ import annotations

import json
import re
import secrets
import time
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException
from pydantic import ValidationError

from ..config import settings
from ..schemas.task import (
    VmaxTask,
    VmaxTaskLLMPart,
    VmaxTaskRepo,
)
from . import anthropic_client, openai_client

SYSTEM_PROMPT = """You are Vmax's task planner. You convert a user's freeform request into a strict task object for a coding agent (Claude Code / Cursor / Codex).

Be terse, decisive, and concrete. Names matter \u2014 prefer real-looking file paths over vague areas. No prose, no hedging.

Respond ONLY with one JSON object (no markdown fence, no commentary) using exactly these keys:
{
  "title": string,                 // 4\u20138 words, imperative, scannable
  "goal": string,                  // one sentence, plain English, names the user-visible outcome
  "type": "bug_fix" | "feature" | "refactor" | "test" | "investigation" | "ui_change" | "infra",
  "priority": "low" | "medium" | "high",
  "filesToInspect": string[],      // 1\u20136 likely paths (best guesses from repo context); use [] only if you genuinely can't guess
  "constraints": string[],         // 1\u20135 tight bullets. ALWAYS include "make the smallest safe change" and "do not refactor unrelated code"
  "successCriteria": string[],     // 1\u20134 observable outcomes \u2014 what the user will SEE working
  "validationCommands": string[],  // verify-only. ONLY from this allowlist: "npm install", "npm run lint", "npm run test", "npm run typecheck", "git status", "git diff", "git diff --stat". Pick the one or two that actually verify this task. Use [] if none apply.
  "riskLevel": "low" | "medium" | "high",
  "approvalPolicy": {
    "requireApprovalBefore": string[]   // e.g. ["edits to files outside filesToInspect", "any schema/migration change", "destructive git operations"]
  },
  "agent": {
    "preferred": "claude_code" | "cursor" | "codex" | "manual",
    "reason": string             // one short clause: why this agent (e.g. "agentic multi-file change", "single-file in-editor edit", "read-only investigation")
  },
  "outputFormat": string[]        // 1\u20133 items: what the agent should produce (e.g. "diff in changed files", "short summary of the change", "passing typecheck")
}

Routing rules (pick "preferred" using these):
- "cursor": single in-editor edit to a named file / function / component.
- "codex": read-only Q&A, "explain", "where is", "find", short investigation.
- "claude_code": default \u2014 multi-file changes, bug fixes, features, refactors, anything that involves running commands.
- "manual": only when the request is ambiguous, dangerous, or requires human judgment first.

Risk rules:
- "low": isolated change, no schema/auth/payments touched, \u22643 files.
- "medium": touches several files, or anything in auth/login/signup/payments/migrations.
- "high": destructive ops, schema migrations, infra, secrets, anything that could break prod.

Approval rules (always include in requireApprovalBefore when relevant):
- riskLevel "medium" or "high" \u2192 require approval before "applying edits".
- Anything involving migrations, schema, env vars, deletes \u2192 require approval before "running validation commands".

Use [] for empty arrays. Never invent files that obviously don't fit the repo's stack."""


# Mirrors FALLBACK_LLM_PART in utils/taskSchema.js. When the model errors
# or returns garbage, we still hand the renderer a usable, *cautious*
# task so the user sees "Task ready (with a warning), approve?" instead
# of a blank failure.
FALLBACK_LLM_PART: dict[str, Any] = {
    "title": "Clarify request",
    "goal": "Restate the user's request as a concrete task before any agent runs.",
    "type": "investigation",
    "priority": "medium",
    "filesToInspect": [],
    "constraints": [
        "make the smallest safe change",
        "do not refactor unrelated code",
        "stop and ask if the goal is ambiguous",
    ],
    "successCriteria": ["the user confirms the restated task matches their intent"],
    "validationCommands": [],
    "riskLevel": "medium",
    "approvalPolicy": {
        "requireApprovalBefore": ["applying any edits", "running validation commands"],
    },
    "agent": {
        "preferred": "manual",
        "reason": "task planner could not parse the model reply",
    },
    "outputFormat": ["a one-line restatement of the task for the user to confirm"],
}


# Validation-command allowlist. Mirrors ALLOWED_REGEX in
# utils/commandSafety.js — kept narrow because the model is told these
# exact strings in the system prompt. Anything else is dropped.
_ALLOWED_VALIDATION_RE = [
    re.compile(r"^npm install(?:\s+[-\w@./^~>=<:*]+)*$", re.IGNORECASE),
    re.compile(r"^npm run lint$", re.IGNORECASE),
    re.compile(r"^npm run test$", re.IGNORECASE),
    re.compile(r"^npm run typecheck$", re.IGNORECASE),
    re.compile(r"^git status$", re.IGNORECASE),
    re.compile(r"^git diff$", re.IGNORECASE),
    re.compile(r"^git diff --stat$", re.IGNORECASE),
]

_FENCED_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)```")


@dataclass(frozen=True)
class TaskResult:
    ok: bool
    task: VmaxTask | None
    parse_warning: bool
    error: str | None = None


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


def _clamp_validation_commands(cmds: list[str] | None) -> list[str]:
    if not isinstance(cmds, list):
        return []
    out: list[str] = []
    for raw in cmds:
        cmd = str(raw or "").strip()
        if not cmd:
            continue
        normalized = re.sub(r"\s+", " ", cmd).strip()
        if any(rx.match(normalized) for rx in _ALLOWED_VALIDATION_RE):
            out.append(cmd)
    return out


def _make_id() -> str:
    # Matches the JS shape: "task_<ms>_<6-hex>".
    return f"task_{int(time.time() * 1000)}_{secrets.token_hex(3)}"


def _flatten_validation_errors(err: ValidationError) -> str:
    bits: list[str] = []
    for issue in err.errors():
        loc = ".".join(str(p) for p in issue.get("loc", ())) or "root"
        bits.append(f"{loc}: {issue.get('msg', 'invalid')}")
    return "; ".join(bits)


def _assemble_task(*, llm_part: dict[str, Any]) -> VmaxTask:
    """Stitch the LLM-filled half + a placeholder repo block into a full task.

    The server doesn't know which repo this task is for — the Electron
    host fills in the actual path from its own `lastRepo` state when it
    triggers an agent. The `repo` block stays on the wire so the Zod
    schema in utils/taskSchema.js still validates.

    Validates with Pydantic at the end so the route can decide whether
    to flag `parseWarning` if something slipped through.
    """
    repo_block = VmaxTaskRepo(
        name="(unknown)",
        path="",
        baseBranch="main",
        targetBranch="main",
    )

    payload: dict[str, Any] = {
        **llm_part,
        "id": _make_id(),
        "repo": repo_block.model_dump(by_alias=True),
        "validationCommands": _clamp_validation_commands(
            llm_part.get("validationCommands")
        ),
    }
    return VmaxTask.model_validate(payload)


async def _call_fast_llm(*, system: str, user: str) -> str:
    """Run the prompt against the cheap/fast model variant.

    Mirrors callOpenAIFast / callClaudeFast in the JS client: OpenAI
    when keyed; Anthropic only when no OpenAI key is set.
    """
    if not settings.has_openai and not settings.has_anthropic:
        raise HTTPException(
            status_code=503,
            detail=(
                "Neither OPENAI_API_KEY nor ANTHROPIC_API_KEY is configured "
                "on the backend. Set one in backend/.env and restart."
            ),
        )

    use_anthropic = settings.has_anthropic and not settings.has_openai
    from ..schemas.common import HistoryTurn

    turns = [HistoryTurn(role="user", text=user)]

    if use_anthropic:
        return await anthropic_client.call_messages_structured(
            system=system,
            turns=turns,
            screenshot_base64=None,
            max_tokens=700,
            temperature=0.2,
            model=settings.anthropic_model_task,
        )
    return await openai_client.call_chat_structured(
        system=system,
        turns=turns,
        screenshot_base64=None,
        temperature=0.2,
        max_tokens=700,
        model=settings.openai_model_task,
    )


async def create_task(
    *,
    prompt: str,
    repo_context_summary: str | None = None,
) -> TaskResult:
    """Create a strict VmaxTask from a user prompt.

    No repo snapshot is sent — the server doesn't know which repo the
    task is for. The Electron host fills in the actual repo path from
    its own state when it triggers the agent.

    Never raises past HTTPException (provider-key missing): on parse /
    validation failure we return a safe fallback task with
    `parse_warning=True` so the renderer can still show
    "Task ready (with a warning), approve?".
    """
    text = (prompt or "").strip()
    if not text:
        return TaskResult(False, None, False, "empty prompt")

    chunks: list[str] = []
    ctx = (repo_context_summary or "").strip()
    if ctx:
        chunks.append(
            "Attached git snapshot (trusted for branches / paths / churn):\n"
            f"{ctx[:8000]}"
        )
    chunks.append(f"User request:\n{text[:4000]}")
    user = "\n\n".join(chunks)

    try:
        raw = await _call_fast_llm(system=SYSTEM_PROMPT, user=user)
    except HTTPException:
        # Missing key / provider 4xx-5xx — bubble up so the route
        # returns the matching status code; the JS wrapper has its
        # own network-failure fallback.
        raise
    except Exception as err:  # noqa: BLE001 — unknown transport errors
        task = _assemble_task(llm_part=FALLBACK_LLM_PART)
        return TaskResult(False, task, True, str(err))

    try:
        obj = _parse_json(raw)
    except ValueError as err:
        task = _assemble_task(llm_part=FALLBACK_LLM_PART)
        return TaskResult(False, task, True, str(err))

    try:
        parsed = VmaxTaskLLMPart.model_validate(obj)
    except ValidationError as err:
        task = _assemble_task(llm_part=FALLBACK_LLM_PART)
        return TaskResult(False, task, True, _flatten_validation_errors(err))

    # Use camelCase for assembly so the alias-aware schemas validate cleanly.
    llm_dict = parsed.model_dump(by_alias=True)
    try:
        task = _assemble_task(llm_part=llm_dict)
    except ValidationError as err:
        # Should be unreachable (parsed already validated), but keep the
        # belt-and-suspenders behaviour of the JS final guard.
        fallback = _assemble_task(llm_part=FALLBACK_LLM_PART)
        return TaskResult(False, fallback, True, _flatten_validation_errors(err))

    return TaskResult(True, task, False, None)
