"""Linear pass-through endpoints.

Used by the renderer when it wants the raw issue payload (e.g. for an
``EXE-35`` quick-look card). The ``/v1/ask`` route also calls the same
underlying client directly when it spots an issue identifier in the
user's question — that path returns a normal StructuredEnvelope so the
Vmax UI doesn't need a special branch."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from ..config import settings
from ..logging_setup import log_audit
from ..services.linear_client import (
    LinearClientError,
    get_linear_issue,
    get_my_linear_issues,
)

router = APIRouter()


def _require_linear() -> None:
    if not settings.has_linear:
        raise HTTPException(
            status_code=503,
            detail=(
                "LINEAR_API_KEY missing on the server. Add it to backend/"
                ".env and restart."
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
    _require_linear()
    try:
        issues = await get_my_linear_issues(limit=limit)
    except LinearClientError as err:
        log_audit("linear_my_issues", ok=False, error=str(err))
        raise HTTPException(status_code=502, detail=str(err))

    log_audit("linear_my_issues", ok=True, count=len(issues), limit=limit)
    return {"issues": issues, "count": len(issues)}
