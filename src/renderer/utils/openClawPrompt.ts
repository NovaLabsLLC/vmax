import type { Plan, FailureExplanation, DiffSummary, RepoContext, VmaxPanelPayload } from "../types";

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
      if (p.whatVmaxSees?.trim()) body += `\n### What Vmax sees\n${p.whatVmaxSees.trim()}\n`;
      if (p.executionRecommendation && p.executionRecommendation !== "none") {
        body += `\nExecution hint: ${p.executionRecommendation}\n`;
      }
      if (p.cursorPrompt) body += `\n### Extra context (Cursor-style)\n${p.cursorPrompt}\n`;
      if (p.claudePrompt && p.claudePrompt !== p.cursorPrompt) {
        body += `\n### Claude Code prompt (if distinct)\n${p.claudePrompt}\n`;
      }
      break;
    }
    case "failure": {
      const f = opts.failure;
      if (!f) return null;
      body = `## User task\n${(opts.task || "").trim() || "(none)"}\n\n## Vmax diagnosis\nWhat: ${f.what}\n`;
      if (f.likelyFile) body += `Likely file: ${f.likelyFile}\n`;
      body += `\nCause: ${f.cause}\n`;
      if (f.next?.length) body += `\nSuggested next:\n${f.next.map((n) => `- ${n}`).join("\n")}\n`;
      if (f.suggestedCommands?.length) {
        body += `\nSuggested commands (verify only):\n${f.suggestedCommands.map((c) => `- ${c}`).join("\n")}\n`;
      }
      if (f.whatVmaxSees?.trim()) body += `\n### What Vmax sees\n${f.whatVmaxSees.trim()}\n`;
      if (f.executionRecommendation && f.executionRecommendation !== "none") {
        body += `\nExecution hint: ${f.executionRecommendation}\n`;
      }
      if (f.cursorPrompt) body += `\n### Fix hint (Cursor)\n${f.cursorPrompt}\n`;
      if (f.claudePrompt && f.claudePrompt !== f.cursorPrompt) {
        body += `\n### Fix hint (Claude Code)\n${f.claudePrompt}\n`;
      }
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
      if (d.whatVmaxSees?.trim()) body += `\n### What Vmax sees\n${d.whatVmaxSees.trim()}\n`;
      if (d.executionRecommendation && d.executionRecommendation !== "none") {
        body += `\nExecution hint: ${d.executionRecommendation}\n`;
      }
      if (d.cursorPrompt) body += `\n### Cursor prompt\n${d.cursorPrompt}\n`;
      if (d.claudePrompt && d.claudePrompt !== d.cursorPrompt) {
        body += `\n### Claude Code prompt\n${d.claudePrompt}\n`;
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

/** OpenClaw message built from a voice / Ask structured panel. */
export function buildOpenClawFromAskPanel(opts: {
  question: string;
  repo: RepoContext | null;
  panel: VmaxPanelPayload;
}): string | null {
  const repoHeader = opts.repo?.ok
    ? `Repository: ${opts.repo.name} — branch ${opts.repo.branch}\nWorking copy: ${opts.repo.root}`
    : "Repository: (not loaded — confirm path before running tools.)";

  const safety = `OpenClaw controlled execution (routed from Vmax)
- Stay in this repo unless the user configured OpenClaw otherwise.
- Respect OpenClaw exec approvals and gateways — never bypass prompts.
- Prefer: git status, git diff, npm run lint, npm run test, npm run typecheck, npm install when needed.
- Never: production deploys, dumping secrets (.env, keys, printenv), git reset --hard, git clean -fd, force push, rm -rf, or destructive edits without explicit human approval each time.
- Finish with a concise summary of actions and results.`;

  const p = opts.panel;
  let body = `## User question\n${(opts.question || "").trim()}\n\n## Vmax answer\n${p.summary}\n`;
  if (p.whatVmaxSees?.trim()) body += `\n### What Vmax sees\n${p.whatVmaxSees.trim()}\n`;
  if (p.likelyProblem?.trim()) body += `\n### Likely problem\n${p.likelyProblem.trim()}\n`;
  if (p.nextSteps?.length) body += `\n### Next steps\n${p.nextSteps.map((n) => `- ${n}`).join("\n")}\n`;
  if (p.suggestedCommands?.length) {
    body += `\n### Suggested commands (verify only)\n${p.suggestedCommands.map((c) => `- ${c}`).join("\n")}\n`;
  }
  if (p.executionRecommendation && p.executionRecommendation !== "none") {
    body += `\nExecution hint: ${p.executionRecommendation}\n`;
  }
  if (p.cursorPrompt?.trim()) body += `\n### Cursor prompt\n${p.cursorPrompt.trim()}\n`;
  if (p.claudePrompt?.trim() && p.claudePrompt !== p.cursorPrompt) {
    body += `\n### Claude Code prompt\n${p.claudePrompt.trim()}\n`;
  }

  let full = `${repoHeader}\n\n${safety}\n\n---\n\n${body}`.trim();
  if (full.length > MAX_BODY) full = full.slice(0, MAX_BODY) + "\n\n[Truncated by Vmax for CLI limits]";
  return full;
}
