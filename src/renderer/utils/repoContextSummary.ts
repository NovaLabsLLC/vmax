import type { RepoContext } from "../types";

const MAX_CHARS = 12_000;

/**
 * Serialized git snapshot from {@link RepoContext}. Sent to `/v1/plan`,
 * `/v1/ask`, `/v1/task`, agents, etc. Keeps payloads bounded.
 */
export function formatRepoContextSummary(repo: RepoContext | null | undefined): string {
  if (!repo || repo.ok !== true) return "";

  const parts: string[] = [
    `name: ${repo.name}`,
    `root: ${repo.root}`,
    `branch: ${repo.branch}`,
  ];

  const changed = repo.changedFiles || [];
  if (changed.length) {
    parts.push(`changed_files (${changed.length}):`);
    for (const f of changed.slice(0, 200)) parts.push(`  - ${f}`);
  }

  const st = repo.status || [];
  if (st.length) {
    parts.push(`git_status_short (${st.length} lines):`);
    parts.push(...st.slice(0, 500));
  }

  if (repo.diffStat) parts.push(`diff_stat:\n${repo.diffStat}`);

  let s = parts.join("\n").trim();
  if (s.length > MAX_CHARS) s = `${s.slice(0, MAX_CHARS)}\n\u2026 (truncated)`;
  return s;
}
