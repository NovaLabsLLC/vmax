"""Detect 'what can you do?' style questions and sanitize meta replies.

Ported from utils/aiClient.js. Keeps behaviour identical so existing
prompt regression baselines stay valid.
"""

from __future__ import annotations

import re

from ..schemas.common import StructuredResponse

_META_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p, re.IGNORECASE)
    for p in (
        r"\bwhat can you do\b",
        r"\bwhat can you\b",
        r"\bwhat do you do\b",
        r"\bwho are you\b",
        r"\bwhat are you\b",
        r"\bwhat is exec\b",
        r"\bwhat'?s exec\b",
        r"\bwhat is vmax\b",
        r"\bwhat'?s vmax\b",
        r"\bhow (does|do) (this|exec|vmax|it|you|the app) work\b",
        r"\bhow can you help\b",
        r"\bhow (may|could) you help\b",
        r"^hey\b.{0,55}\b(what can you|help)\b",
        r"^hi\b.{0,55}\b(what can you|help)\b",
        r"^hello\b.{0,55}\b(what can you|help)\b",
        r"^help\b[!.? ]*$",
        r"\bcapabilit(y|ies)\b",
        r"\btell me about (yourself|exec|vmax)\b",
        r"\bintroduce yourself\b",
    )
)

_TASK_LIKE = re.compile(
    r"\b(error|stack trace|exception|failed|broken|bug|fix my|fix this|untracked|"
    r"git status|npm err|traceback|syntaxerror|cannot find module)\b",
    re.IGNORECASE,
)


def is_meta_capability_question(raw: str | None) -> bool:
    if not raw:
        return False

    q = raw.strip().lower().replace("\u2019", "'")
    q = re.sub(r"\s+", " ", q)
    if not q or len(q) > 280:
        return False
    if not any(p.search(q) for p in _META_PATTERNS):
        return False
    if _TASK_LIKE.search(q):
        return False
    return True


META_ASK_FALLBACK_STEPS: list[str] = [
    "Tap the mic on the pill for voice \u2014 same model as text chat.",
    "Use the chat bubble to type; expand it when you want a wider transcript.",
    "Open Command Center from the pill to attach a repo, plan work, and run checks.",
    "Settings \u2192 Agents shows which Claude / Codex / Cursor bridges are connected.",
]


_GITTY_STEP = re.compile(
    r"\b(git\s|untracked|\.git\b|rm\s+-rf|\bgit\b|diff --|commits?\b|"
    r"staging\b|vesper|bcongruence)\b",
    re.IGNORECASE,
)

_GITTY_SUMMARY = re.compile(
    r"\b(git\b|untracked|rm\s+-rf|stage\b|commit\b|vesper|bcongruence|"
    r"\/[\w.-]+(?:\/[\w.-]+){1,4})\b",
    re.IGNORECASE,
)


_FALLBACK_SUMMARY = (
    "Vmax is the Mac overlay for building with agents: voice + chat on the "
    "pill, Command Center for repos and plans, and handoff to Cursor / "
    "Claude Code. Use me for quick Q&A here; open the workspace when you "
    "want file-aware workflows."
)


def sanitize_meta_ask_payload(data: StructuredResponse) -> StructuredResponse:
    steps = [
        s.strip()
        for s in (data.next_steps or [])
        if s and s.strip() and not _GITTY_STEP.search(s)
    ]

    summary = (data.summary or "").strip()
    if not summary or _GITTY_SUMMARY.search(summary):
        summary = _FALLBACK_SUMMARY

    return StructuredResponse(
        summary=summary,
        what_vmax_sees="",
        likely_problem="",
        next_steps=steps if steps else META_ASK_FALLBACK_STEPS,
        cursor_prompt="",
        claude_prompt="",
        suggested_commands=[],
        execution_recommendation="none",
        speakable_summary=data.speakable_summary,
    )
