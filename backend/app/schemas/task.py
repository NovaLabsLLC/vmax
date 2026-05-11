"""Task-planner schemas.

Mirrors utils/taskSchema.js (Zod) on the JS side so the wire format is
stable. The LLM only fills `VmaxTaskLLMPart`; the server adds `id` +
`repo` to produce a complete `VmaxTask` before returning.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

TaskType = Literal[
    "bug_fix",
    "feature",
    "refactor",
    "test",
    "investigation",
    "ui_change",
    "infra",
]
Priority = Literal["low", "medium", "high"]
RiskLevel = Literal["low", "medium", "high"]
Agent = Literal["claude_code", "cursor", "codex", "manual"]


class VmaxTaskRepoSnapshot(BaseModel):
    """Repo snapshot the client passes in (output of utils/repoContext.scanRepo).

    Permissive on purpose — older callers may omit fields. Anything we
    actually need on the server falls back to a safe default.
    """

    model_config = ConfigDict(extra="ignore")

    ok: bool = True
    name: str | None = None
    branch: str | None = None
    root: str | None = None
    path: str | None = None
    changed_files: list[str] = Field(default_factory=list)


class VmaxTaskRepo(BaseModel):
    """The repo block embedded in the assembled VmaxTask."""

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    name: str
    path: str
    base_branch: str = Field(alias="baseBranch")
    target_branch: str = Field(alias="targetBranch")


class ApprovalPolicy(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    require_approval_before: list[str] = Field(
        default_factory=list, alias="requireApprovalBefore"
    )


class AgentChoice(BaseModel):
    model_config = ConfigDict(extra="ignore")

    preferred: Agent
    reason: str


class VmaxTaskLLMPart(BaseModel):
    """The half the LLM fills.

    The JS schema enforces `successCriteria.min(1)` and `title.min(1)` /
    `goal.min(1)`. We mirror that with Field(min_length=...) so Pydantic
    validation matches.
    """

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    title: str = Field(min_length=1)
    goal: str = Field(min_length=1)
    type: TaskType
    priority: Priority
    files_to_inspect: list[str] = Field(default_factory=list, alias="filesToInspect")
    constraints: list[str] = Field(default_factory=list)
    success_criteria: list[str] = Field(min_length=1, alias="successCriteria")
    validation_commands: list[str] = Field(
        default_factory=list, alias="validationCommands"
    )
    risk_level: RiskLevel = Field(alias="riskLevel")
    approval_policy: ApprovalPolicy = Field(alias="approvalPolicy")
    agent: AgentChoice
    output_format: list[str] = Field(default_factory=list, alias="outputFormat")


class VmaxTask(BaseModel):
    """The full assembled task returned to the client (camelCase on the wire)."""

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    id: str
    title: str
    goal: str
    repo: VmaxTaskRepo
    type: TaskType
    priority: Priority
    files_to_inspect: list[str] = Field(alias="filesToInspect")
    constraints: list[str]
    success_criteria: list[str] = Field(alias="successCriteria")
    validation_commands: list[str] = Field(alias="validationCommands")
    risk_level: RiskLevel = Field(alias="riskLevel")
    approval_policy: ApprovalPolicy = Field(alias="approvalPolicy")
    agent: AgentChoice
    output_format: list[str] = Field(alias="outputFormat")


class TaskRequest(BaseModel):
    """POST /v1/task body.

    `repo` and `target_branch` come from the Electron host; `prompt` is
    the user's freeform request.
    """

    model_config = ConfigDict(extra="ignore")

    prompt: str = Field(min_length=1)
    repo: VmaxTaskRepoSnapshot | None = None
    target_branch: str | None = None


class TaskResponse(BaseModel):
    """POST /v1/task response. Mirrors the JS return shape exactly."""

    model_config = ConfigDict(extra="ignore")

    ok: bool
    task: VmaxTask | None = None
    parse_warning: bool = False
    error: str | None = None
