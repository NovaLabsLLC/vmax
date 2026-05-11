"""Synthesize a rich Markdown brief from a Linear Workspace bundle.

Used when pulling an issue into the Task field so Cursor / Claude Code get
explicit goals, hypotheses, acceptance checks, etc. Optionally sync that
brief back into Linear (between HTML comment markers).
"""

from __future__ import annotations

import re
from typing import Any

from fastapi import HTTPException

from ..config import settings
from . import anthropic_client, openai_client
from .linear_client import LinearClientError, get_linear_issue, linear_update_issue

VMAX_AGENT_BRIEF_START = "<!-- vmax-agent-brief:start -->"
VMAX_AGENT_BRIEF_END = "<!-- vmax-agent-brief:end -->"

_MAX_PROMPT_CHARS = 28_000
_MAX_REPLY_TOKENS = 2600


def merge_agent_brief_into_description(previous: str | None, brief_md: str) -> str:
    """Insert or replace one fenced vmax agent-brief region in Linear Markdown."""
    inner = brief_md.strip()
    block_body = f"{VMAX_AGENT_BRIEF_START}\n{inner}\n{VMAX_AGENT_BRIEF_END}"
    prev_raw = previous or ""

    start_i = prev_raw.find(VMAX_AGENT_BRIEF_START)
    if start_i != -1:
        end_rel = prev_raw.find(VMAX_AGENT_BRIEF_END, start_i + len(VMAX_AGENT_BRIEF_START))
        if end_rel != -1:
            end_j = end_rel + len(VMAX_AGENT_BRIEF_END)
            before = prev_raw[:start_i].rstrip()
            after = prev_raw[end_j:].lstrip()
            glue = ""
            if before:
                glue = "\n\n"
            mid = glue + block_body
            trailing = ("\n\n" + after) if after else ""
            return before + mid + trailing

    base = prev_raw.rstrip()
    sep = "\n\n" if base else ""
    return base + sep + block_body + "\n"


def _truncate_for_llm(blob: str) -> str:
    blob = blob.strip()
    if len(blob) <= _MAX_PROMPT_CHARS:
        return blob
    head = _MAX_PROMPT_CHARS // 2
    tail = _MAX_PROMPT_CHARS - head - 80
    return (
        blob[:head]
        + "\n\n… [truncated middle for LLM budget] …\n\n"
        + blob[-max(tail, 0) :]
    )


_fence_re = re.compile(r"^\s*```(?:markdown)?\s*([\s\S]*?)```\s*$", re.IGNORECASE)


def _normalize_model_markdown(reply: str) -> str:
    s = reply.strip()
    m = _fence_re.match(s)
    if m:
        s = (m.group(1) or "").strip()
    return s


_SYSTEM_AGENT_BRIEF = """You are an expert staff engineer briefing autonomous coding agents (Cursor, Claude Code, Codex).
The user pasted a "**Linear Workspace bundle**" — metadata, description, comments, URLs.

Your job is to expand it into a **dense, explicit Markdown briefing** agents can execute without Linear open.

Rules:
- Output **Markdown only**. No preamble like "Sure" or trailing commentary outside the briefing.
- Be concrete where the bundle allows; clearly label guesses vs facts (prefix guesses with "**Assumption:**").
- Prefer bullet lists over long prose.
- Include these sections exactly (omit a section body only when there is genuinely nothing to say → keep the heading + "—").
  ### Goal
  ### Background & constraints
  ### What to investigate / change first
  ### Suggested tactics (architecture, rollout, sequencing)
  ### Likely touched areas *(paths, folders, configs — inferred from clues)*
  ### Acceptance criteria
  ### Out of scope 
  ### Risks & failure modes

Keep the briefing under ~1200 English words unless the issue is unusually large."""

async def generate_agent_brief_markdown(workspace_bundle: str) -> str:
    if not workspace_bundle.strip():
        raise HTTPException(status_code=400, detail="workspace_bundle cannot be blank")

    if not settings.has_openai and not settings.has_anthropic:
        raise HTTPException(
            status_code=503,
            detail=(
                "Neither OPENAI_API_KEY nor ANTHROPIC_API_KEY configured — "
                "cannot synthesize agent brief."
            ),
        )

    clipped = _truncate_for_llm(workspace_bundle)
    user = (
        "Here is the **Linear Workspace bundle** (possibly truncated internally):\n\n"
        f"{clipped}\n\n"
        "Produce the Markdown briefing described in your system prompt."
    )

    use_anthropic = settings.has_anthropic and not settings.has_openai

    try:
        if use_anthropic:
            raw = await anthropic_client.call_messages_plaintext(
                system=_SYSTEM_AGENT_BRIEF,
                user=user,
                max_tokens=_MAX_REPLY_TOKENS,
                temperature=0.35,
                model=settings.anthropic_model_task,
            )
        else:
            raw = await openai_client.call_chat_plaintext(
                system=_SYSTEM_AGENT_BRIEF,
                user=user,
                temperature=0.35,
                max_tokens=_MAX_REPLY_TOKENS,
                model=settings.openai_model_task,
            )
    except HTTPException:
        raise
    except Exception as err:
        raise HTTPException(status_code=502, detail=f"Agent-brief LLM failed: {err}") from err

    out = _normalize_model_markdown(raw)
    if len(out) < 40:
        raise HTTPException(
            status_code=502,
            detail="Model returned empty or trivial agent brief.",
        )
    return out


def compose_workspace_task(bundle: str, brief_md: str) -> str:
    return (
        bundle.strip()
        + "\n\n---\n\n## Agent brief (Cursor / Claude / Codex)\n\n"
        + brief_md.strip()
    )


async def sync_agent_brief_to_linear(issue_identifier: str, brief_md: str) -> dict[str, Any]:
    issue = await get_linear_issue(issue_identifier)
    if not issue:
        raise LinearClientError(f"Issue {issue_identifier} not found in Linear.")

    merged = merge_agent_brief_into_description(str(issue.get("description") or ""), brief_md)
    updated = await linear_update_issue(
        issue_identifier.strip(),
        description=merged,
    )
    return updated
