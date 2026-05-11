"""POST /v1/task — turn a freeform user prompt into a strict VmaxTask.

This is the small/fast LLM call the renderer uses to render
"Task ready: …  Approve?" before any agent is invoked. Failure to parse
or validate the model reply is *not* a 5xx — the planner returns a safe
fallback task with `parse_warning=True` so the user always has something
to confirm or cancel.
"""

from __future__ import annotations

from fastapi import APIRouter

from ..schemas.task import TaskRequest, TaskResponse
from ..services import task_planner

router = APIRouter()


@router.post("/task", response_model=TaskResponse)
async def create_task(body: TaskRequest) -> TaskResponse:
    result = await task_planner.create_task(
        prompt=body.prompt,
        repo_context_summary=body.repo_context_summary,
    )
    return TaskResponse(
        ok=result.ok,
        task=result.task,
        parse_warning=result.parse_warning,
        error=result.error,
    )
