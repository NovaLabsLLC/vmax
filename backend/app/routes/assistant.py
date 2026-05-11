"""Vmax assistant endpoints: ask / plan / explain-failure / summarize-diff.

Each route prepares the system prompt + turn list, runs it through the LLM
router, and returns a uniform `StructuredEnvelope`. The Electron client
maps that envelope into UI-shaped objects (Plan / Failure / Diff /
AskPanel) on its side.

These routes are intentionally repo-agnostic — no `repo` field is
accepted on the wire. Earlier versions piped the user's repo snapshot
into the system prompt, which caused the model to hallucinate about
untracked files when users asked unrelated questions like "hello"."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from ..schemas.common import HistoryTurn, StructuredResponse
from ..schemas.requests import (
    AskRequest,
    ExplainFailureRequest,
    PlanRequest,
    SummarizeDiffRequest,
)
from ..logging_setup import log_audit
from ..schemas.responses import StructuredEnvelope
from ..services import linear_workspaces
from ..services import llm_router
from ..services.linear_client import (
    LinearClientError,
    aggregate_open_assigned_issues,
    extract_linear_issue_id,
    extract_linear_issue_update_fields,
    format_linear_issue_summary,
    format_linear_speakable,
    format_my_issues_speakable,
    format_my_issues_summary,
    get_linear_issue,
    is_my_issues_question,
    linear_update_issue,
    prefers_linear_issue_read_over_update,
)
from ..services.meta_capability import (
    is_meta_capability_question,
    sanitize_meta_ask_payload,
)
from ..services.prompts import (
    ASK_META_SYSTEM,
    ASK_STRUCTURED_SYSTEM,
    DIFF_SYSTEM,
    FAILURE_SYSTEM,
    PLAN_SYSTEM,
)
from ..services.structured import malformed_structured_response

router = APIRouter()

OUTPUT_TRUNCATE_CHARS = 8_000
DIFF_TRUNCATE_CHARS = 30_000
REPO_CONTEXT_CHARS = 12_000


MY_ISSUES_FETCH_LIMIT = 25


async def _linear_single_issue_envelope(issue_id: str) -> StructuredEnvelope | None:
    """Fetch one issue and render it. Returns None to signal "fall
    through to the LLM" — used when Linear itself errors. Returns a
    StructuredEnvelope (even for not-found) when we have a definite
    answer for the user."""
    try:
        issue = await get_linear_issue(issue_id)
    except LinearClientError as err:
        log_audit(
            "ask_linear_shortcut",
            kind="issue",
            issue_id=issue_id,
            ok=False,
            fell_through=True,
            error=str(err),
        )
        return None

    if not issue:
        payload = StructuredResponse(
            summary=f"I couldn't find {issue_id} in Linear.",
            likely_problem=(
                "The issue ID may be wrong, deleted, archived, or outside "
                "your API key permissions."
            ),
            speakable_summary=f"I couldn't find {issue_id} in Linear.",
            execution_recommendation="none",
        )
        log_audit(
            "ask_linear_shortcut",
            kind="issue",
            issue_id=issue_id,
            ok=False,
            not_found=True,
        )
        return StructuredEnvelope(structured=payload, parse_warning=False)

    payload = StructuredResponse(
        summary=format_linear_issue_summary(issue_id, issue),
        speakable_summary=format_linear_speakable(issue_id, issue),
        what_vmax_sees=f"Linear issue {issue_id}",
        execution_recommendation="none",
    )
    log_audit(
        "ask_linear_shortcut",
        kind="issue",
        issue_id=issue_id,
        ok=True,
        title=issue.get("title") or "",
        state=(issue.get("state") or {}).get("name") or "",
        url=issue.get("url") or "",
    )
    return StructuredEnvelope(structured=payload, parse_warning=False)


async def _linear_update_issue_envelope(
    issue_id: str,
    fields: dict[str, Any],
) -> StructuredEnvelope:
    """Persist an ``issueUpdate`` when the user asked to change Linear."""
    try:
        updated = await linear_update_issue(
            issue_id,
            state_target=(fields.get("state_target")),
            title=(fields.get("title")),
            description=(fields.get("description")),
            description_append=(fields.get("description_append")),
            priority=(fields.get("priority")),
        )
        body = format_linear_issue_summary(issue_id, updated)
        payload = StructuredResponse(
            summary=f"Updated {issue_id} in Linear.\n\n{body}",
            speakable_summary=(
                f"{issue_id} updated in Linear. "
                f"{format_linear_speakable(issue_id, updated)}"
            ),
            what_vmax_sees=f"Linear issue updated {issue_id}",
            execution_recommendation="none",
        )
        log_audit(
            "ask_linear_shortcut",
            kind="issue_update",
            issue_id=issue_id,
            ok=True,
            title=updated.get("title") or "",
            state=(updated.get("state") or {}).get("name") or "",
            url=updated.get("url") or "",
        )
        return StructuredEnvelope(structured=payload, parse_warning=False)
    except LinearClientError as err:
        payload_err = StructuredResponse(
            summary=f"I could not update {issue_id} in Linear: {err}",
            likely_problem=(
                "The wording may need a clearer state label, or Linear "
                "rejected the change (permissions, workflow, or archived issue)."
            ),
            speakable_summary=f"{issue_id} could not be updated in Linear.",
            execution_recommendation="none",
        )
        log_audit(
            "ask_linear_shortcut",
            kind="issue_update",
            issue_id=issue_id,
            ok=False,
            error=str(err),
        )
        return StructuredEnvelope(structured=payload_err, parse_warning=False)


async def _linear_my_issues_envelope() -> StructuredEnvelope | None:
    """Fetch the viewer's assigned-and-open issues and render them as a
    priority-sorted list. Returns None on Linear error so the LLM can
    take over; returns a real envelope (even for an empty queue) when
    Linear responded."""
    try:
        issues = await aggregate_open_assigned_issues(MY_ISSUES_FETCH_LIMIT)
    except LinearClientError as err:
        log_audit(
            "ask_linear_shortcut",
            kind="my_issues",
            ok=False,
            fell_through=True,
            error=str(err),
        )
        return None

    payload = StructuredResponse(
        summary=format_my_issues_summary(issues),
        speakable_summary=format_my_issues_speakable(issues),
        what_vmax_sees=f"Linear: {len(issues)} open issues assigned to viewer",
        execution_recommendation="none",
    )
    log_audit(
        "ask_linear_shortcut",
        kind="my_issues",
        ok=True,
        count=len(issues),
        top_issue=(issues[0].get("identifier") if issues else ""),
    )
    return StructuredEnvelope(structured=payload, parse_warning=False)


async def _try_linear_shortcut(question: str) -> StructuredEnvelope | None:
    """Deterministic Linear answers:

      1. Read: "what is EXE-35" — fetches one issue.
      2. Mutate: imperatives like "mark EXE-35 as done", "move EXE-35 to In
         Review", "priority … to high" — applies ``issueUpdate``.
      3. List: "what should I work on" / "my tickets" — open assigned issues.

    Interrogative prompts win over updates; a bare issue id still fetches.

    Returns None to fall through when no key, no match, or upstream error
    (depending on path)."""
    if not linear_workspaces.effective_workspaces():
        return None

    issue_id = extract_linear_issue_id(question)
    if issue_id:
        if not prefers_linear_issue_read_over_update(question):
            update_fields = extract_linear_issue_update_fields(question, issue_id)
            if update_fields:
                return await _linear_update_issue_envelope(issue_id, update_fields)

        return await _linear_single_issue_envelope(issue_id)

    if is_my_issues_question(question):
        return await _linear_my_issues_envelope()

    return None


@router.post("/ask", response_model=StructuredEnvelope)
async def ask(body: AskRequest) -> StructuredEnvelope:
    # Fast path: deterministic Linear lookup beats hallucinating about a
    # screenshot. Falls through to the LLM if no issue id is detected,
    # no key is configured, or Linear errored.
    shortcut = await _try_linear_shortcut(body.question)
    if shortcut is not None:
        log_audit(
            "ask",
            source="linear",
            parse_warning=shortcut.parse_warning,
            question=body.question,
            has_screenshot=bool(body.screenshot_base64),
            history_turns=len(body.history or []),
            summary=shortcut.structured.summary,
            speakable_summary=shortcut.structured.speakable_summary,
            likely_problem=shortcut.structured.likely_problem,
            execution_recommendation=shortcut.structured.execution_recommendation,
        )
        return shortcut

    meta = is_meta_capability_question(body.question)

    context_block = (
        "No repo or screen context applies to this turn (capability / "
        "meta question)."
        if meta
        else "Context: general developer Q&A. Do not assume the user has a "
        "specific repo open unless a repository snapshot is attached below."
    )
    repo_blob = ""
    raw_repo = body.repo_context_summary
    if (raw_repo or "").strip() and not meta:
        repo_blob = "\n--- Attached repository snapshot ---\n"
        repo_blob += (raw_repo or "").strip()[:REPO_CONTEXT_CHARS]

    system_body = ASK_META_SYSTEM if meta else ASK_STRUCTURED_SYSTEM
    system_with_context = f"{system_body}\n\n--- Live context ---\n{context_block}{repo_blob}"

    turns: list[HistoryTurn] = []
    if not meta:
        # Match the JS: keep the last 6 turns of history.
        for turn in (body.history or [])[-6:]:
            if turn.text:
                turns.append(turn)

    if meta:
        user_text = (
            f"{body.question.strip()}\n\n(Reply with product capabilities only "
            "\u2014 do not use git, repo paths, or file system advice unless "
            "I asked about those explicitly.)"
        )
    else:
        user_text = body.question
    turns.append(HistoryTurn(role="user", text=user_text))

    result = await llm_router.call_structured_response(
        system=system_with_context,
        turns=turns,
        screenshot_base64=None if meta else body.screenshot_base64,
    )

    payload = sanitize_meta_ask_payload(result.data) if meta else result.data

    log_audit(
        "ask",
        source="llm",
        meta=meta,
        parse_warning=not result.ok,
        question=body.question,
        has_screenshot=bool(body.screenshot_base64),
        history_turns=len(body.history or []),
        summary=payload.summary,
        speakable_summary=payload.speakable_summary,
        likely_problem=payload.likely_problem,
        next_steps_count=len(payload.next_steps or []),
        suggested_commands_count=len(payload.suggested_commands or []),
        execution_recommendation=payload.execution_recommendation,
        has_cursor_prompt=bool(payload.cursor_prompt),
        has_claude_prompt=bool(payload.claude_prompt),
    )

    return StructuredEnvelope(structured=payload, parse_warning=not result.ok)


@router.post("/plan", response_model=StructuredEnvelope)
async def plan(body: PlanRequest) -> StructuredEnvelope:
    lines: list[str] = []
    if body.task:
        lines.append(f"Task:\n{body.task}")
    if (body.repo_context_summary or "").strip():
        lines.append(
            f"\n--- repository snapshot ---\n"
            f"{(body.repo_context_summary or '').strip()[:REPO_CONTEXT_CHARS]}"
        )
    if body.diff:
        lines.append(f"\n--- diff (truncated) ---\n{body.diff[:DIFF_TRUNCATE_CHARS]}")
    user = "\n".join(lines) if lines else "(no task description provided)"

    turns = [HistoryTurn(role="user", text=user)]
    result = await llm_router.call_structured_response(
        system=PLAN_SYSTEM,
        turns=turns,
        screenshot_base64=body.screenshot_base64,
    )
    return StructuredEnvelope(structured=result.data, parse_warning=not result.ok)


@router.post("/explain-failure", response_model=StructuredEnvelope)
async def explain_failure(body: ExplainFailureRequest) -> StructuredEnvelope:
    head = f"Task:\n{body.task}\n\n" if body.task else ""
    extra = ""
    if (body.repo_context_summary or "").strip():
        extra = (
            f"\n--- repository snapshot ---\n"
            f"{body.repo_context_summary.strip()[:REPO_CONTEXT_CHARS]}\n\n"
        )
    user = (
        f"{head}{extra}Command: {body.command}\n\n"
        f"--- Output (last {OUTPUT_TRUNCATE_CHARS} chars) ---\n"
        f"{(body.output or '')[-OUTPUT_TRUNCATE_CHARS:]}"
    )
    turns = [HistoryTurn(role="user", text=user)]
    result = await llm_router.call_structured_response(
        system=FAILURE_SYSTEM,
        turns=turns,
        screenshot_base64=body.screenshot_base64,
    )
    return StructuredEnvelope(structured=result.data, parse_warning=not result.ok)


@router.post("/summarize-diff", response_model=StructuredEnvelope)
async def summarize_diff(body: SummarizeDiffRequest) -> StructuredEnvelope:
    diff = (body.diff or "").strip()
    if not diff:
        # Match the JS: empty diff is not an error, it's just nothing to do.
        empty = StructuredResponse(
            summary="(no diff)",
            execution_recommendation="none",
        )
        return StructuredEnvelope(structured=empty, parse_warning=False)

    turns = [HistoryTurn(role="user", text=f"--- diff ---\n{diff[:DIFF_TRUNCATE_CHARS]}")]
    try:
        result = await llm_router.call_structured_response(
            system=DIFF_SYSTEM,
            turns=turns,
            screenshot_base64=None,
        )
    except Exception as err:
        # The client has its own local fallback summary; signal an error
        # via parse_warning + a hint in likely_problem so it can blend.
        bad = malformed_structured_response(f"API error: {err}")
        return StructuredEnvelope(structured=bad, parse_warning=True)

    return StructuredEnvelope(structured=result.data, parse_warning=not result.ok)
