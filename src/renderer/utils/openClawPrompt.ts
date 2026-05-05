import type { Plan, FailureExplanation, DiffSummary, RepoContext } from "../types";

const MAX_BODY = 60_000;

/** Message passed as a single `openclaw agent --message` argv (no shell interpolation). */
export function buildOpenClawAgentMessage(opts: {
  task: string;
  repo: RepoContext | null;
  kind: "plan" | "failure" | "diff";
  plan?: Plan | null;
  failure?: FailureExplanation | null;
  diff?: DiffSummary | null;
}): string | null {
  const repoHeader = opts.repo?.ok
    ? `Repository: ${opts.repo.name} — branch ${opts.repo.branch}\nWorking copy: ${opts.repo.root}`
    : "Repository: (not loaded or scan failed — confirm path before running tools.)";

  const safety = `OpenClaw controlled execution (routed from Vmax)
- Stay in this repo unless the user configured OpenClaw otherwise.
- Respect OpenClaw exec approvals and gateways — never bypass prompts.
- Prefer: git status, git diff, npm run lint, npm run test, npm run typecheck, npm install when needed.
- Never: production deploys, dumping secrets (.env, keys, printenv), git reset --hard, git clean -fd, force push, rm -rf, or destructive edits without explicit human approval each time.
- Finish with a concise summary of actions and results.`;

  let body = "";
  switch (opts.kind) {
    case "plan": {
      const p = opts.plan;
      if (!p) return null;
      body = `## User task\n${(opts.task || "").trim() || "(none)"}\n\n## Vmax plan\n${p.summary}\n`;
      if (p.files?.length) {
        body += `\n### Files\n${p.files.map((f) => `- ${f.path} — ${f.why}`).join("\n")}\n`;
      }
      if (p.risks?.length) body += `\n### Risks\n${p.risks.map((r) => `- ${r}`).join("\n")}\n`;
      if (p.command) body += `\nSuggested verify command (only if policy allows): ${p.command}\n`;
      if (p.cursorPrompt) body += `\n### Extra context (Cursor-style)\n${p.cursorPrompt}\n`;
      break;
    }
    case "failure": {
      const f = opts.failure;
      if (!f) return null;
      body = `## User task\n${(opts.task || "").trim() || "(none)"}\n\n## Vmax diagnosis\nWhat: ${f.what}\n`;
      if (f.likelyFile) body += `Likely file: ${f.likelyFile}\n`;
      body += `\nCause: ${f.cause}\n`;
      if (f.next?.length) body += `\nSuggested next:\n${f.next.map((n) => `- ${n}`).join("\n")}\n`;
      if (f.cursorPrompt) body += `\n### Fix hint\n${f.cursorPrompt}\n`;
      break;
    }
    case "diff": {
      const d = opts.diff;
      if (!d) return null;
      body = `## User task\n${(opts.task || "").trim() || "(none)"}\n\n## Vmax diff summary\n${d.summary}\n`;
      if (d.files?.length) body += `\n### Files\n${d.files.map((f) => `- ${f.path} — ${f.change}`).join("\n")}\n`;
      if (d.risks?.length) body += `\n### Risks\n${d.risks.map((r) => `- ${r}`).join("\n")}\n`;
      if (d.nextChecks?.length) {
        body += `\n### Checks (safe only)\n${d.nextChecks.map((c) => `- ${c}`).join("\n")}\n`;
      }
      break;
    }
    default:
      return null;
  }

  let full = `${repoHeader}\n\n${safety}\n\n---\n\n${body}`.trim();
  if (full.length > MAX_BODY) full = full.slice(0, MAX_BODY) + "\n\n[Truncated by Vmax for CLI limits]";
  return full;
}
