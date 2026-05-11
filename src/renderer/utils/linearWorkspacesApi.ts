/**
 * Renderer-side client for the backend's Linear workspace CRUD endpoints
 * (see backend/app/routes/linear.py). The raw API key is sent only on
 * POST /workspaces; every subsequent response surfaces `key_preview`
 * instead of the secret.
 */

import { backendFetch } from "./backendApi";

export type LinearWorkspace = {
  id: string;
  label: string;
  workspace_name: string;
  workspace_url_key: string;
  viewer_name: string;
  viewer_email: string;
  added_at: number;
  key_preview: string;
};

export async function listLinearWorkspaces(): Promise<LinearWorkspace[]> {
  const data = await backendFetch<{ workspaces: LinearWorkspace[]; count: number }>(
    "/v1/linear/workspaces",
  );
  return Array.isArray(data?.workspaces) ? data.workspaces : [];
}

export async function addLinearWorkspace(input: {
  apiKey: string;
  label?: string;
}): Promise<LinearWorkspace> {
  const data = await backendFetch<{ workspace: LinearWorkspace }>(
    "/v1/linear/workspaces",
    {
      method: "POST",
      body: JSON.stringify({
        api_key: input.apiKey,
        label: input.label || "",
      }),
    },
  );
  return data.workspace;
}

export async function removeLinearWorkspace(id: string): Promise<void> {
  await backendFetch<{ ok: true }>(`/v1/linear/workspaces/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function renameLinearWorkspace(
  id: string,
  label: string,
): Promise<LinearWorkspace> {
  const data = await backendFetch<{ workspace: LinearWorkspace }>(
    `/v1/linear/workspaces/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ label }),
    },
  );
  return data.workspace;
}
