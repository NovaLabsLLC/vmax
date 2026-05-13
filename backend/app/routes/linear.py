"""Linear pass-through endpoints.

Two surfaces live here:

1. **Issue lookups and patch** — ``GET /issues/{issue_id}`` plus
   ``PATCH /issues/{issue_id}`` (title, description, priority, due date,
   workflow state).

2. **Create + team pick** — ``POST /issues`` creates an ``issueCreate`` row;
   ``GET /teams`` lists team ids/keys scoped to one connected workspace when
   the UI builds the picker.

3. **Workspace CRUD** for the Settings UI — the renderer manages the
   list of connected Linear workspaces by hitting these endpoints. Each
   workspace stores its own personal API key on the backend (see
   ``app.services.linear_workspaces``). The raw key never leaves the
   server — list responses include a ``key_preview`` instead.

``GET /issues`` (no id) fans out across every saved workspace, tags each
returned issue with ``_workspace_name`` so the model can answer questions
like "what's on my Acme plate" without losing context, and aggregates
per-workspace failures separately so a single bad key never blocks the
others.
"""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query
from pydantic import BaseModel, Field

from ..config import settings
from ..logging_setup import log_audit
from ..services import linear_workspaces
from ..services.linear_client import (
    LinearClientError,
    create_linear_issue_with_key,
    get_all_my_open_issues_with_key,
    get_linear_issue,
    get_my_linear_issues,
    get_my_open_issues_with_key,
    linear_update_issue,
    list_teams_for_key,
    sort_my_issues,
    verify_linear_key,
)
from ..services.linear_agent_brief import (
    compose_workspace_task,
    generate_agent_brief_markdown,
    sync_agent_brief_to_linear,
)
from ..services.linear_issue_image_draft import draft_issue_from_image, draft_issue_from_transcript

router = APIRouter()


# ---------------------------------------------------------------------------
# Issue lookups (unchanged contract — used by /v1/ask and quick-look cards)
# ---------------------------------------------------------------------------


def _require_linear() -> None:
    """Legacy guard — only relevant when no saved workspaces exist and
    callers still rely on the env-driven ``LINEAR_API_KEY``."""
    if not settings.has_linear and not linear_workspaces.list_workspaces():
        raise HTTPException(
            status_code=503,
            detail=(
                "No Linear workspaces connected. Add one in Settings, or set "
                "LINEAR_API_KEY in backend/.env and restart."
            ),
        )


def _workspace_for_request(workspace_id: str | None) -> linear_workspaces.LinearWorkspace:
    """Pick the saved Linear workspace key for a mutation when the user has
    one or many orgs connected."""
    wss = linear_workspaces.effective_workspaces()
    if not wss:
        raise HTTPException(
            status_code=503,
            detail=(
                "No Linear workspaces connected. Add one in Settings, or set "
                "LINEAR_API_KEY in backend/.env and restart."
            ),
        )
    if len(wss) == 1:
        return wss[0]
    wid = (workspace_id or "").strip()
    if not wid:
        raise HTTPException(
            status_code=400,
            detail="workspace_id is required when multiple Linear workspaces are connected.",
        )
    ws = linear_workspaces.find(wid)
    if not ws:
        raise HTTPException(status_code=404, detail="Linear workspace not found.")
    return ws


@router.get("/teams")
async def list_teams(workspace_id: str | None = Query(default=None)) -> dict[str, Any]:
    """Teams in the scoped workspace (needed to pick ``team_id`` when creating issues)."""

    _require_linear()
    ws = _workspace_for_request(workspace_id)
    api_key = (ws.key or "").strip()
    if not api_key:
        raise HTTPException(status_code=502, detail="Linear API key is empty for this workspace.")
    try:
        teams = await list_teams_for_key(api_key)
    except LinearClientError as err:
        log_audit("linear_teams_list", workspace_id=ws.id, ok=False, error=str(err))
        raise HTTPException(status_code=502, detail=str(err))
    log_audit("linear_teams_list", workspace_id=ws.id, ok=True, count=len(teams))
    return {"teams": teams, "workspace_id": ws.id}


class LinearIssueCreateBody(BaseModel):
    title: str = Field(..., min_length=1, max_length=512)
    team_id: str = Field(
        ...,
        min_length=1,
        description="Linear team UUID or short key (EXE, INT, …).",
    )
    description: str | None = Field(default=None, max_length=50_000)
    workspace_id: str | None = Field(
        default=None,
        description="Saved workspace row id (`lw_*`) — required when several orgs exist.",
    )
    priority: int | None = Field(default=None, ge=0, le=4)
    assign_to_me: bool = Field(
        default=True,
        description="Sets assigneeId to the API key viewer when true.",
    )


@router.post("/issues")
async def create_issue(body: LinearIssueCreateBody = Body(...)) -> dict[str, Any]:
    """Create a Linear issue via ``issueCreate`` (scoped to one connected workspace)."""

    _require_linear()
    ws = _workspace_for_request(body.workspace_id)
    api_key = (ws.key or "").strip()
    if not api_key:
        raise HTTPException(status_code=502, detail="Linear API key is empty for this workspace.")
    try:
        issue = await create_linear_issue_with_key(
            api_key,
            team_id=body.team_id.strip(),
            title=body.title.strip(),
            description=body.description,
            priority=body.priority,
            assignee_self=body.assign_to_me,
        )
    except LinearClientError as err:
        log_audit("linear_issue_create", ok=False, error=str(err))
        raise HTTPException(status_code=502, detail=str(err))

    ident = issue.get("identifier") or ""
    title = issue.get("title") or ""
    log_audit(
        "linear_issue_create",
        ok=True,
        workspace_id=ws.id,
        issue_id=ident,
        title=str(title)[:120],
    )
    return {"issue": issue, "workspace_id": ws.id}


class LinearIssueDraftFromImageBody(BaseModel):
    """Raw base64 or ``data:image/...;base64,...``; validated strictly in ``draft_issue_from_image``."""

    image_base64: str = Field(
        ...,
        min_length=1,
        description="Base64-encoded screenshot (optional data-URL wrapper).",
    )


class LinearIssueDraftFromTranscriptBody(BaseModel):
    """Voice pill / overlay chat transcript → Linear ``title`` + ``description`` draft."""

    transcript: str = Field(
        ...,
        min_length=1,
        description="Spoken or typed notes describing the engineering task.",
    )


@router.post("/issue-draft-from-transcript")
async def linear_issue_draft_from_transcript(
    body: LinearIssueDraftFromTranscriptBody = Body(...),
) -> dict[str, str]:
    """Turn informal speech/text into Title + Description for Add Linear task."""

    raw_len = len((body.transcript or "").strip())

    log_audit(
        "linear_issue_draft_transcript",
        ok=True,
        phase="requested",
        transcript_chars=raw_len,
    )

    try:
        out = await draft_issue_from_transcript(transcript=body.transcript)
    except HTTPException as err:
        log_audit(
            "linear_issue_draft_transcript",
            ok=False,
            phase="http_error",
            status_code=err.status_code,
            detail=str(err.detail),
        )
        raise
    except Exception as err:
        log_audit("linear_issue_draft_transcript", ok=False, phase="error", error=str(err))
        raise HTTPException(
            status_code=502,
            detail="Failed to draft Linear issue from transcript.",
        ) from err

    log_audit(
        "linear_issue_draft_transcript",
        ok=True,
        phase="completed",
        title_preview=(out.get("title") or "")[:80],
    )
    return {"title": out["title"], "description": out["description"]}


@router.post("/issue-draft-from-image")
async def linear_issue_draft_from_image(body: LinearIssueDraftFromImageBody = Body(...)) -> dict[str, str]:
    """Vision model proposes Linear ``title`` and ``description`` for the Add-task modal."""

    image_size = len(body.image_base64 or "")

    log_audit(
        "linear_issue_draft_image",
        ok=True,
        phase="requested",
        b64_chars=image_size,
    )

    try:
        out = await draft_issue_from_image(image_base64=body.image_base64)
    except HTTPException as err:
        log_audit(
            "linear_issue_draft_image",
            ok=False,
            phase="http_error",
            status_code=err.status_code,
            detail=str(err.detail),
        )
        raise
    except Exception as err:
        log_audit("linear_issue_draft_image", ok=False, phase="error", error=str(err))
        raise HTTPException(
            status_code=502,
            detail="Failed to draft Linear issue from image.",
        ) from err

    log_audit(
        "linear_issue_draft_image",
        ok=True,
        phase="completed",
        title_preview=(out.get("title") or "")[:80],
    )
    return {"title": out["title"], "description": out["description"]}


@router.get("/issues/{issue_id}")
async def read_linear_issue(issue_id: str) -> dict[str, Any]:
    _require_linear()
    try:
        issue = await get_linear_issue(issue_id)
    except LinearClientError as err:
        log_audit("linear_issue_lookup", issue_id=issue_id, ok=False, error=str(err))
        raise HTTPException(status_code=502, detail=str(err))

    if not issue:
        log_audit("linear_issue_lookup", issue_id=issue_id, ok=False, error="not_found")
        raise HTTPException(status_code=404, detail=f"Issue {issue_id} not found")

    log_audit(
        "linear_issue_lookup",
        issue_id=issue_id,
        ok=True,
        title=issue.get("title") or "",
        state=(issue.get("state") or {}).get("name") or "",
    )
    return issue


class LinearIssuePatchBody(BaseModel):
    state_target: str | None = Field(
        default=None,
        description="Workflow column name or synonym (done, backlog, canceled, …).",
    )
    title: str | None = None
    description: str | None = None
    description_append: str | None = Field(
        default=None,
        description="Concatenates after existing description (exclusive with full replace).",
    )
    priority: int | None = Field(default=None, ge=0, le=4)
    due_date: str | None = Field(
        default=None,
        description=(
            "Calendar due date YYYY-MM-DD only. Send explicit JSON null "
            "(field present with null value) to clear the due date."
        ),
    )


@router.patch("/issues/{issue_id}")
async def patch_linear_issue(
    issue_id: str,
    body: LinearIssuePatchBody = Body(...),
) -> dict[str, Any]:
    _require_linear()
    if body.description is not None and body.description_append is not None:
        raise HTTPException(
            status_code=400,
            detail="Use either description or description_append, not both.",
        )

    due_date_was_set = "due_date" in body.model_fields_set

    touched = (
        body.state_target is not None,
        body.title is not None,
        body.description is not None,
        body.description_append is not None,
        body.priority is not None,
        due_date_was_set,
    )
    if not any(touched):
        raise HTTPException(status_code=400, detail="No fields supplied to patch")

    kwargs: dict[str, Any] = {}
    if body.state_target is not None:
        ks = body.state_target.strip()
        if ks:
            kwargs["state_target"] = ks
        else:
            raise HTTPException(
                status_code=400,
                detail="state_target, when present, cannot be blank",
            )
    if body.title is not None:
        kwargs["title"] = body.title.strip() or ""
    if body.description is not None:
        kwargs["description"] = body.description
    if body.description_append is not None:
        kwargs["description_append"] = body.description_append

    prio = None if body.priority is None else body.priority
    if prio is not None:
        kwargs["priority"] = prio

    try:
        issue = await linear_update_issue(
            issue_id.strip(),
            state_target=(kwargs.pop("state_target", None)),
            title=kwargs.get("title"),
            description=kwargs.pop("description", None),
            description_append=(kwargs.pop("description_append", None)),
            priority=(kwargs.pop("priority", None)),
            due_date=body.due_date if due_date_was_set else None,
            due_date_was_set=due_date_was_set,
        )
    except LinearClientError as err:
        log_audit(
            "linear_issue_patch",
            issue_id=issue_id,
            ok=False,
            error=str(err),
        )
        raise HTTPException(status_code=502, detail=str(err))

    log_audit(
        "linear_issue_patch",
        issue_id=issue_id,
        ok=True,
        title=issue.get("title") or "",
        state=(issue.get("state") or {}).get("name") or "",
    )
    return issue


class LinearAgentBriefBody(BaseModel):
    workspace_bundle: str = Field(
        ...,
        min_length=1,
        description=(
            "The full Workspace task bundle (metadata + Markdown) built client-side "
            "from Linear issue payload."
        ),
    )


@router.post("/issues/{issue_id}/agent-brief")
async def linear_issue_agent_brief(
    issue_id: str,
    body: LinearAgentBriefBody = Body(...),
) -> dict[str, Any]:
    """LLM-expand a Workspace bundle → rich agent brief + optional Linear sync.

    The brief is pasted into Linear's description inside HTML markers so repeats
    replace the prior block rather than stacking duplicates."""
    _require_linear()
    ident = issue_id.strip()
    if not ident:
        raise HTTPException(status_code=400, detail="Missing issue identifier")

    try:
        brief_md = await generate_agent_brief_markdown(body.workspace_bundle)
    except HTTPException:
        raise

    composed = compose_workspace_task(body.workspace_bundle, brief_md)

    linear_updated = False
    linear_error: str | None = None
    try:
        await sync_agent_brief_to_linear(ident, brief_md)
        linear_updated = True
    except LinearClientError as err:
        linear_error = str(err)

    log_audit(
        "linear_agent_brief",
        issue_id=ident,
        ok=True,
        linear_updated=linear_updated,
        error=linear_error or "",
    )
    out: dict[str, Any] = {
        "task_text": composed,
        "linear_updated": linear_updated,
    }
    if linear_error:
        out["linear_error"] = linear_error
    return out


@router.get("/issues")
async def list_my_linear_issues(
    limit: int = Query(default=25, ge=1, le=100),
    fetch_all: bool = Query(
        default=False,
        description=(
            "Paginate through assigned issues and return every **open** ticket "
            "(capped server-side). Ignores ``limit`` when true."
        ),
    ),
) -> dict[str, Any]:
    """Fan out across every saved workspace. Falls back to the legacy
    env-key path when no workspaces are stored, so existing setups keep
    working unchanged."""
    workspaces = linear_workspaces.effective_workspaces()
    if not workspaces:
        _require_linear()  # raises 503 with a helpful detail

    # Legacy single-env-key path: keep the response shape stable so
    # callers that don't know about multi-workspace still work.
    if len(workspaces) == 1 and workspaces[0].id == "legacy":
        try:
            if fetch_all:
                key = (workspaces[0].key or "").strip()
                if not key:
                    raise LinearClientError("legacy workspace has no API key")
                issues = await get_all_my_open_issues_with_key(key)
            else:
                issues = await get_my_linear_issues(limit=limit)
        except LinearClientError as err:
            log_audit("linear_my_issues", ok=False, error=str(err))
            raise HTTPException(status_code=502, detail=str(err))
        issues = sort_my_issues(issues)
        log_audit(
            "linear_my_issues",
            ok=True,
            count=len(issues),
            fetch_all=fetch_all,
            limit=(None if fetch_all else limit),
        )
        return {"issues": issues, "count": len(issues), "workspaces": [], "errors": []}

    async def fetch(ws: linear_workspaces.LinearWorkspace) -> tuple[
        linear_workspaces.LinearWorkspace, list[dict[str, Any]] | LinearClientError
    ]:
        try:
            api_key = (ws.key or "").strip()
            if not api_key:
                return ws, LinearClientError("Linear API key is empty")
            if fetch_all:
                issues = await get_all_my_open_issues_with_key(api_key)
            else:
                issues = await get_my_open_issues_with_key(api_key, limit=limit)
            return ws, issues
        except LinearClientError as err:
            return ws, err

    results = await asyncio.gather(*[fetch(w) for w in workspaces])

    merged: list[dict[str, Any]] = []
    per_workspace: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    for ws, outcome in results:
        ws_name = ws.label or ws.workspace_name or "workspace"
        if isinstance(outcome, LinearClientError):
            errors.append({"id": ws.id, "name": ws_name, "error": str(outcome)})
            continue
        # Tag each issue with its workspace so the model + UI can route on it.
        for issue in outcome:
            issue["_workspace_id"] = ws.id
            issue["_workspace_name"] = ws_name
        merged.extend(outcome)
        per_workspace.append(
            {
                "id": ws.id,
                "name": ws_name,
                "viewer_name": ws.viewer_name,
                "count": len(outcome),
            }
        )

    merged = sort_my_issues(merged)

    log_audit(
        "linear_my_issues",
        ok=True,
        count=len(merged),
        workspaces=len(per_workspace),
        errors=len(errors),
        limit=(None if fetch_all else limit),
        fetch_all=fetch_all,
    )
    return {
        "issues": merged,
        "count": len(merged),
        "workspaces": per_workspace,
        "errors": errors,
    }


# ---------------------------------------------------------------------------
# Workspace CRUD — Settings UI calls these directly from the renderer.
# ---------------------------------------------------------------------------


class AddWorkspaceBody(BaseModel):
    api_key: str = Field(..., min_length=1)
    label: str = ""


class RenameWorkspaceBody(BaseModel):
    label: str = ""


@router.get("/workspaces")
async def list_workspaces_route() -> dict[str, Any]:
    """Public, key-stripped list of connected workspaces."""
    entries = linear_workspaces.list_workspaces()
    return {
        "workspaces": [linear_workspaces.to_public(w) for w in entries],
        "count": len(entries),
    }


@router.post("/workspaces")
async def add_workspace_route(body: AddWorkspaceBody) -> dict[str, Any]:
    """Verify the key with Linear, then persist it. Returns the public
    entry (no raw key) so the UI can render it immediately."""
    key = body.api_key.strip()
    if not key:
        raise HTTPException(status_code=400, detail="API key is empty")

    try:
        info = await verify_linear_key(key)
    except LinearClientError as err:
        log_audit("linear_workspace_add", ok=False, error=str(err))
        # 502 mirrors the other Linear failure paths — the upstream service
        # rejected the key. The detail is safe to surface (Linear errors are
        # human-readable and don't leak server state).
        raise HTTPException(status_code=502, detail=str(err))

    entry = linear_workspaces.upsert(
        key=key,
        label=body.label.strip(),
        workspace_name=info.get("workspace_name", ""),
        workspace_url_key=info.get("workspace_url_key", ""),
        viewer_name=info.get("viewer_name", ""),
        viewer_email=info.get("viewer_email", ""),
    )
    log_audit(
        "linear_workspace_add",
        ok=True,
        workspace_id=entry.id,
        workspace_name=entry.workspace_name,
        viewer_email=entry.viewer_email,
    )
    return {"workspace": linear_workspaces.to_public(entry)}


@router.delete("/workspaces/{workspace_id}")
async def remove_workspace_route(workspace_id: str) -> dict[str, Any]:
    removed = linear_workspaces.remove(workspace_id)
    log_audit("linear_workspace_remove", ok=removed, workspace_id=workspace_id)
    if not removed:
        raise HTTPException(status_code=404, detail="workspace not found")
    return {"ok": True}


@router.patch("/workspaces/{workspace_id}")
async def rename_workspace_route(
    workspace_id: str,
    body: RenameWorkspaceBody,
) -> dict[str, Any]:
    entry = linear_workspaces.rename(workspace_id, body.label)
    log_audit(
        "linear_workspace_rename",
        ok=bool(entry),
        workspace_id=workspace_id,
        label=body.label,
    )
    if not entry:
        raise HTTPException(status_code=404, detail="workspace not found")
    return {"workspace": linear_workspaces.to_public(entry)}
