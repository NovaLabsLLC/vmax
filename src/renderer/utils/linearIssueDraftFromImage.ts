import { backendFetch } from "./backendApi";

export type LinearIssueDraftFromImageResponse = {
  title: string;
  description: string;
};

/** POST JPEG as raw base64; backend runs vision → title + description. */
export async function draftLinearIssueFromImage(
  imageBase64Raw: string,
): Promise<LinearIssueDraftFromImageResponse> {
  return backendFetch<LinearIssueDraftFromImageResponse>("/v1/linear/issue-draft-from-image", {
    method: "POST",
    body: JSON.stringify({ image_base64: imageBase64Raw }),
  });
}
