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

from fastapi import APIRouter

from ..schemas.common import HistoryTurn, StructuredResponse
from ..schemas.requests import (
    AskRequest,
    ExplainFailureRequest,
    PlanRequest,
    SummarizeDiffRequest,
)
from ..schemas.responses import StructuredEnvelope
from ..services import llm_router
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


@router.post("/ask", response_model=StructuredEnvelope)
async def ask(body: AskRequest) -> StructuredEnvelope:
    meta = is_meta_capability_question(body.question)

    context_block = (
        "No repo or screen context applies to this turn (capability / "
        "meta question)."
        if meta
        else "Context: general developer Q&A. Do not assume the user has a "
        "specific repo open."
    )

    system_body = ASK_META_SYSTEM if meta else ASK_STRUCTURED_SYSTEM
    system_with_context = f"{system_body}\n\n--- Live context ---\n{context_block}"

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
    return StructuredEnvelope(structured=payload, parse_warning=not result.ok)


@router.post("/plan", response_model=StructuredEnvelope)
async def plan(body: PlanRequest) -> StructuredEnvelope:
    lines: list[str] = []
    if body.task:
        lines.append(f"Task:\n{body.task}")
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
    user = (
        f"{head}Command: {body.command}\n\n"
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
