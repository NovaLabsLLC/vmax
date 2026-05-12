/** Match Linear shorthand ids (EXE-28, ENG-401). Mirrors backend heuristic. */
const LINEAR_ISSUE_ID_RE = /\b[A-Z]{2,10}-\d+\b/;

/** First Linear-style issue id in plain text, or null. Input is uppercased for lookup. */
export function extractLinearIssueId(text: string | null | undefined): string | null {
  const t = String(text || "").trim();
  if (!t) return null;
  const m = LINEAR_ISSUE_ID_RE.exec(t.toUpperCase());
  return m ? m[0] : null;
}
