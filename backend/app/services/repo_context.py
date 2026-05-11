"""Render a RepoContext + task + optional diff into the user-prompt
preamble. Mirrors renderRepoContext() from utils/aiClient.js."""

from __future__ import annotations

from ..schemas.common import RepoContext

DIFF_TRUNCATE_CHARS = 12_000


def render_repo_context(
    *,
    task: str | None,
    repo: RepoContext | None,
    diff: str | None = None,
    include_diff: bool = False,
) -> str:
    lines: list[str] = []
    if task:
        lines.append(f"Task:\n{task}")

    if repo is not None:
        lines.append(f"\nRepo: {repo.name or '(unknown)'}")
        if repo.branch:
            lines.append(f"Branch: {repo.branch}")
        if repo.changed_files:
            indented = "\n".join(f"  {item}" for item in repo.changed_files)
            lines.append(f"Changed files:\n{indented}")
        if repo.status:
            indented = "\n".join(f"  {line}" for line in repo.status)
            lines.append(f"git status --short:\n{indented}")
        if repo.diff_stat:
            lines.append(f"diff --stat:\n{repo.diff_stat}")

    if include_diff and diff:
        lines.append(f"\n--- diff (truncated) ---\n{diff[:DIFF_TRUNCATE_CHARS]}")

    return "\n".join(lines)
