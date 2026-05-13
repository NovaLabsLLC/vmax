import { backendFetch } from "./backendApi";

export type LinearIssueDraftFromTranscriptResponse = {
  title: string;
  description: string;
};

export async function draftLinearIssueFromTranscript(
  transcript: string,
): Promise<LinearIssueDraftFromTranscriptResponse> {
  return backendFetch("/v1/linear/issue-draft-from-transcript", {
    method: "POST",
    body: JSON.stringify({ transcript: transcript.trim() }),
  });
}
