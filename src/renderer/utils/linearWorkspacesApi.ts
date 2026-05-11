/**
 * Linear workspaces — Electron main persists keys in exec-state.json
 * (~/Library/Application Support/…); we only ever see public metadata +
 * last-4-char preview via IPC.
 */

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
  const data = await window.exec.linearWorkspacesList();
  return Array.isArray(data?.workspaces) ? data.workspaces : [];
}

export async function addLinearWorkspace(input: {
  apiKey: string;
  label?: string;
}): Promise<LinearWorkspace> {
  const result = await window.exec.linearWorkspacesAdd({
    apiKey: input.apiKey,
    label: input.label || "",
  });
  if (!result.ok || !("workspace" in result) || !result.workspace) {
    throw new Error(
      typeof (result as { error?: string }).error === "string"
        ? (result as { error: string }).error
        : "linear:add failed",
    );
  }
  return result.workspace;
}

export async function removeLinearWorkspace(id: string): Promise<void> {
  const result = await window.exec.linearWorkspacesRemove(id);
  if (!result.ok) {
    throw new Error(
      "error" in result && typeof result.error === "string"
        ? result.error
        : "linear:remove failed",
    );
  }
}

export async function renameLinearWorkspace(
  id: string,
  label: string,
): Promise<LinearWorkspace> {
  const result = await window.exec.linearWorkspacesRename(id, label);
  if (!result.ok || !("workspace" in result) || !result.workspace) {
    throw new Error(
      "error" in result && typeof result.error === "string"
        ? result.error
        : "linear:rename failed",
    );
  }
  return result.workspace;
}
