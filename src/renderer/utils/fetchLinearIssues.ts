import { backendFetch } from "./backendApi";

/** One row from GET /v1/linear/issues — mirrors `_ISSUE_FIELDS` on the backend. */
export type LinearIssueRow = {
  id?: string;
  identifier?: string;
  title?: string;
  description?: string | null;
  url?: string;
  priority?: number | null;
  estimate?: number | null;
  branchName?: string | null;
  createdAt?: string;
  updatedAt?: string;
  dueDate?: string | null;
  state?: { id?: string; name?: string; type?: string };
  team?: { id?: string; key?: string; name?: string };
  assignee?: { id?: string; name?: string; displayName?: string; email?: string };
  creator?: { id?: string; name?: string; email?: string };
  project?: { id?: string; name?: string; state?: string };
  cycle?: { id?: string; name?: string; startsAt?: string; endsAt?: string };
  labels?: { nodes?: { id?: string; name?: string }[] };
  comments?: {
    nodes?: {
      id?: string;
      body?: string;
      createdAt?: string;
      user?: { name?: string; email?: string };
    }[];
  };
  _workspace_id?: string;
  _workspace_name?: string;
};

export type FetchLinearIssuesResult = {
  issues: LinearIssueRow[];
  count: number;
  workspaces: { id: string; name: string; viewer_name?: string; count: number }[];
  errors: { id: string; name: string; error: string }[];
};

/** All connected workspaces — paginated fetch of every **open** issue assigned to you. */
export async function fetchAllMyLinearIssues(): Promise<FetchLinearIssuesResult> {
  const sp = new URLSearchParams({ fetch_all: "true" });
  return backendFetch<FetchLinearIssuesResult>(`/v1/linear/issues?${sp.toString()}`, {
    method: "GET",
  });
}
