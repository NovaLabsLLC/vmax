import type { LinearIssueRow } from "./fetchLinearIssues";

const PRIORITY_LABEL: Record<number, string> = {
  0: "None",
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
};

function priorityLabel(raw: LinearIssueRow["priority"]): string {
  if (raw === null || raw === undefined) return PRIORITY_LABEL[0];
  const n = Number(raw);
  return PRIORITY_LABEL[n] ?? `Priority ${raw}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n\n… (truncated; open link in Linear for full text)`;
}

/** Rich task text for Workspace / planners — Markdown description preserved. */
export function formatLinearIssueAsWorkspaceTask(
  row: LinearIssueRow,
  opts?: { maxDescriptionChars?: number; maxCommentCharsEach?: number },
): string {
  const maxDesc = opts?.maxDescriptionChars ?? 40_000;
  const commentCap = opts?.maxCommentCharsEach ?? 900;

  const id = row.identifier?.trim() || "?";
  const title = (row.title || "").trim() || "(no title)";

  const lines: string[] = [];
  lines.push(`Linear ${id}: ${title}`);
  lines.push("");

  const meta: string[] = [];
  if (row.url) meta.push(`URL: ${row.url}`);
  if (row._workspace_name) meta.push(`Workspace: ${row._workspace_name}`);
  if (row.state?.name) meta.push(`Status: ${row.state.name}`);
  meta.push(`Priority: ${priorityLabel(row.priority)}`);
  if (row.team?.key || row.team?.name) {
    meta.push(`Team: ${row.team.key || row.team.name}${row.team.name && row.team.key ? ` (${row.team.name})` : ""}`);
  }
  if (row.project?.name) meta.push(`Project: ${row.project.name}`);
  if (row.cycle?.name) meta.push(`Cycle: ${row.cycle.name}`);
  if (row.dueDate) meta.push(`Due: ${row.dueDate}`);
  if (row.estimate !== undefined && row.estimate !== null) meta.push(`Estimate: ${String(row.estimate)}`);
  if (row.branchName) meta.push(`Branch: ${row.branchName}`);
  const assignee = row.assignee;
  if (assignee) {
    const who = assignee.displayName || assignee.name || assignee.email;
    if (who) meta.push(`Assignee: ${who}`);
  }

  lines.push(meta.join("\n"));

  const labelNodes =
    typeof row.labels === "object" && row.labels !== null && "nodes" in row.labels
      ? (row.labels as { nodes?: { name?: string }[] }).nodes
      : null;
  if (labelNodes?.length) {
    const names = labelNodes.map((x) => x?.name).filter(Boolean) as string[];
    if (names.length) {
      lines.push("");
      lines.push(`Labels: ${names.join(", ")}`);
    }
  }

  const descRaw = typeof row.description === "string" ? row.description.trim() : "";
  if (descRaw) {
    lines.push("");
    lines.push("## Description");
    lines.push(truncate(descRaw, maxDesc));
  }

  const commentNodes =
    typeof row.comments === "object" && row.comments !== null && "nodes" in row.comments
      ? ((row.comments as { nodes?: { body?: string; createdAt?: string; user?: { name?: string; email?: string } }[] })
          .nodes || [])
          .slice()
          .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      : [];

  if (commentNodes.length) {
    lines.push("");
    lines.push(`## Recent comments (newest first, ${Math.min(commentNodes.length, 5)} of ${commentNodes.length})`);
    for (const c of commentNodes.slice(0, 5)) {
      const who = (c.user?.name || c.user?.email || "Someone").trim();
      let body = (c.body || "").trim().replace(/\r\n/g, "\n");
      body = truncate(body, commentCap);
      lines.push("");
      lines.push(`— ${who} (${c.createdAt || "?"})`);
      lines.push(body);
    }
  }

  return lines.join("\n").trimEnd();
}
