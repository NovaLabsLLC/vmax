import { backendFetch } from "./backendApi";
import type { LinearIssueRow } from "./fetchLinearIssues";

export async function patchLinearIssueState(
  issueId: string,
  body: { state_target: string },
): Promise<LinearIssueRow> {
  const id = encodeURIComponent(String(issueId || "").trim());
  if (!id) throw new Error("Missing Linear issue id");
  return backendFetch<LinearIssueRow>(`/v1/linear/issues/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

/** Move workflow column toward Linear's ``completed`` type (synonym: ``done``). */
export async function moveLinearIssueToDone(issueId: string): Promise<LinearIssueRow> {
  return patchLinearIssueState(issueId, { state_target: "done" });
}

/** Resolve a workflow column labeled like ``In Review`` / review queue. */
export async function moveLinearIssueToInReview(issueId: string): Promise<LinearIssueRow> {
  return patchLinearIssueState(issueId, { state_target: "in review" });
}
