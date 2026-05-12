import { backendFetch } from "./backendApi";
import type { LinearIssueRow } from "./fetchLinearIssues";

export type LinearIssuePatchPayload = {
  state_target?: string;
  title?: string;
  description?: string | null;
  /** Concatenates after existing description; exclusive with description. */
  description_append?: string | null;
  priority?: number | null;
  /**
   * YYYY-MM-DD. Include with JSON `null` to clear Linear due date (field must be present).
   * Omit entirely to leave unchanged.
   */
  due_date?: string | null;
};

function compactPatchPayload(body: LinearIssuePatchPayload): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (body.state_target !== undefined) out.state_target = body.state_target;
  if (body.title !== undefined) out.title = body.title;
  if (body.description !== undefined) out.description = body.description;
  if (body.description_append !== undefined) out.description_append = body.description_append;
  if (body.priority !== undefined) out.priority = body.priority;
  if (body.due_date !== undefined) out.due_date = body.due_date;
  return out;
}

export async function patchLinearIssue(
  issueId: string,
  body: LinearIssuePatchPayload,
): Promise<LinearIssueRow> {
  const id = encodeURIComponent(String(issueId || "").trim());
  if (!id) throw new Error("Missing Linear issue id");
  const payload = compactPatchPayload(body);
  const keys = Object.keys(payload);
  if (keys.length === 0) throw new Error("No fields supplied to patch");
  return backendFetch<LinearIssueRow>(`/v1/linear/issues/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function patchLinearIssueState(
  issueId: string,
  body: { state_target: string },
): Promise<LinearIssueRow> {
  return patchLinearIssue(issueId, body);
}

/** Move workflow column toward Linear's ``completed`` type (synonym: ``done``). */
export async function moveLinearIssueToDone(issueId: string): Promise<LinearIssueRow> {
  return patchLinearIssue(issueId, { state_target: "done" });
}

/** Resolve a workflow column labeled like ``In Review`` / review queue. */
export async function moveLinearIssueToInReview(issueId: string): Promise<LinearIssueRow> {
  return patchLinearIssue(issueId, { state_target: "in review" });
}
