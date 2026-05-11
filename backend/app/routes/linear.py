"""Linear pass-through endpoints.

Two surfaces live here:

1. **Issue-level lookups** for ``/v1/ask`` and quick-look cards
   (``GET /issues/{issue_id}``).

2. **Workspace CRUD** for the Settings UI — the renderer manages the
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
    get_linear_issue,
    get_my_linear_issues,
    get_my_open_issues_with_key,
    verify_linear_key,
)

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


@router.get("/issues")
async def list_my_linear_issues(
    limit: int = Query(default=25, ge=1, le=100),
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
            issues = await get_my_linear_issues(limit=limit)
        except LinearClientError as err:
            log_audit("linear_my_issues", ok=False, error=str(err))
            raise HTTPException(status_code=502, detail=str(err))
        log_audit("linear_my_issues", ok=True, count=len(issues), limit=limit)
        return {"issues": issues, "count": len(issues), "workspaces": [], "errors": []}

    async def fetch(ws: linear_workspaces.LinearWorkspace) -> tuple[
        linear_workspaces.LinearWorkspace, list[dict[str, Any]] | LinearClientError
    ]:
        try:
            issues = await get_my_open_issues_with_key(ws.key, limit=limit)
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

    log_audit(
        "linear_my_issues",
        ok=True,
        count=len(merged),
        workspaces=len(per_workspace),
        errors=len(errors),
        limit=limit,
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
