import { backendFetch } from "./backendApi";
import type { LinearIssueRow } from "./fetchLinearIssues";

/** Team row from ``GET /v1/linear/teams``. */
export type LinearTeamOption = {
  id?: string;
  key?: string;
  name?: string;
};

export async function fetchLinearTeams(workspaceId?: string): Promise<{
  teams: LinearTeamOption[];
  workspace_id: string;
}> {
  const sp = new URLSearchParams();
  if (workspaceId) sp.set("workspace_id", workspaceId);
  const q = sp.toString();
  return backendFetch(`/v1/linear/teams${q ? `?${q}` : ""}`, { method: "GET" });
}

export async function createLinearIssue(payload: {
  title: string;
  description?: string;
  team_id: string;
  workspace_id?: string;
  priority?: number | null;
  assign_to_me?: boolean;
}): Promise<{ issue: LinearIssueRow; workspace_id: string }> {
  return backendFetch("/v1/linear/issues", {
    method: "POST",
    body: JSON.stringify({
      title: payload.title.trim(),
      team_id: payload.team_id.trim(),
      description:
        typeof payload.description === "string" && payload.description.trim()
          ? payload.description.trim()
          : undefined,
      workspace_id: payload.workspace_id?.trim() || undefined,
      priority:
        typeof payload.priority === "number" && payload.priority >= 0 && payload.priority <= 4
          ? payload.priority
          : undefined,
      assign_to_me: payload.assign_to_me !== false,
    }),
  });
}
