// Vmax strict task schema + a small/fast LLM call that turns a freeform
// user prompt into a validated VmaxTask the renderer can show as
// "Task ready: …  Approve?".
//
// Budget: 500ms–2s end-to-end. We deliberately:
//   • use the cheapest/fastest model variants (gpt-4o-mini or Claude Haiku)
//   • skip screenshots and diffs
//   • cap max_tokens low
//   • include only a minimal repo snapshot (name, branch, top changed files)
//
// The schema below is the contract — the LLM fills the model-decided fields,
// we fill `id` + `repo` ourselves, and we clamp validationCommands to the
// Vmax allowlist before returning.

const crypto = require("crypto");
const { z } = require("zod");
const { getCommandBlockReason } = require("./commandSafety.js");

const OPENAI_KEY = () => process.env.OPENAI_API_KEY || "";
const ANTHROPIC_KEY = () => process.env.ANTHROPIC_API_KEY || "";

const TaskTypeEnum = z.enum([
  "bug_fix",
  "feature",
  "refactor",
  "test",
  "investigation",
  "ui_change",
  "infra",
]);
const PriorityEnum = z.enum(["low", "medium", "high"]);
const RiskEnum = z.enum(["low", "medium", "high"]);
const AgentEnum = z.enum(["claude_code", "cursor", "codex", "manual"]);

const VmaxTaskRepoSchema = z.object({
  name: z.string(),
  path: z.string(),
  baseBranch: z.string(),
  targetBranch: z.string(),
});

const VmaxTaskSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  goal: z.string().min(1),
  repo: VmaxTaskRepoSchema,
  type: TaskTypeEnum,
  priority: PriorityEnum,
  filesToInspect: z.array(z.string()),
  constraints: z.array(z.string()),
  successCriteria: z.array(z.string()).min(1),
  validationCommands: z.array(z.string()),
  riskLevel: RiskEnum,
  approvalPolicy: z.object({
    requireApprovalBefore: z.array(z.string()),
  }),
  agent: z.object({
    preferred: AgentEnum,
    reason: z.string(),
  }),
  outputFormat: z.array(z.string()),
});

/** The half the LLM fills — `id` and `repo` come from the host. */
const VmaxTaskLLMPartSchema = VmaxTaskSchema.omit({ id: true, repo: true });

const SYSTEM_PROMPT = `You are Vmax's task planner. You convert a user's freeform request into a strict task object for a coding agent (Claude Code / Cursor / Codex).

Be terse, decisive, and concrete. Names matter — prefer real-looking file paths over vague areas. No prose, no hedging.

Respond ONLY with one JSON object (no markdown fence, no commentary) using exactly these keys:
{
  "title": string,                 // 4–8 words, imperative, scannable
  "goal": string,                  // one sentence, plain English, names the user-visible outcome
  "type": "bug_fix" | "feature" | "refactor" | "test" | "investigation" | "ui_change" | "infra",
  "priority": "low" | "medium" | "high",
  "filesToInspect": string[],      // 1–6 likely paths (best guesses from repo context); use [] only if you genuinely can't guess
  "constraints": string[],         // 1–5 tight bullets. ALWAYS include "make the smallest safe change" and "do not refactor unrelated code"
  "successCriteria": string[],     // 1–4 observable outcomes — what the user will SEE working
  "validationCommands": string[],  // verify-only. ONLY from this allowlist: "npm install", "npm run lint", "npm run test", "npm run typecheck", "git status", "git diff", "git diff --stat". Pick the one or two that actually verify this task. Use [] if none apply.
  "riskLevel": "low" | "medium" | "high",
  "approvalPolicy": {
    "requireApprovalBefore": string[]   // e.g. ["edits to files outside filesToInspect", "any schema/migration change", "destructive git operations"]
  },
  "agent": {
    "preferred": "claude_code" | "cursor" | "codex" | "manual",
    "reason": string             // one short clause: why this agent (e.g. "agentic multi-file change", "single-file in-editor edit", "read-only investigation")
  },
  "outputFormat": string[]        // 1–3 items: what the agent should produce (e.g. "diff in changed files", "short summary of the change", "passing typecheck")
}

Routing rules (pick "preferred" using these):
- "cursor": single in-editor edit to a named file / function / component.
- "codex": read-only Q&A, "explain", "where is", "find", short investigation.
- "claude_code": default — multi-file changes, bug fixes, features, refactors, anything that involves running commands.
- "manual": only when the request is ambiguous, dangerous, or requires human judgment first.

Risk rules:
- "low": isolated change, no schema/auth/payments touched, ≤3 files.
- "medium": touches several files, or anything in auth/login/signup/payments/migrations.
- "high": destructive ops, schema migrations, infra, secrets, anything that could break prod.

Approval rules (always include in requireApprovalBefore when relevant):
- riskLevel "medium" or "high" → require approval before "applying edits".
- Anything involving migrations, schema, env vars, deletes → require approval before "running validation commands".

Use [] for empty arrays. Never invent files that obviously don't fit the repo's stack.`;

const FALLBACK_LLM_PART = {
  title: "Clarify request",
  goal: "Restate the user's request as a concrete task before any agent runs.",
  type: "investigation",
  priority: "medium",
  filesToInspect: [],
  constraints: [
    "make the smallest safe change",
    "do not refactor unrelated code",
    "stop and ask if the goal is ambiguous",
  ],
  successCriteria: ["the user confirms the restated task matches their intent"],
  validationCommands: [],
  riskLevel: "medium",
  approvalPolicy: {
    requireApprovalBefore: ["applying any edits", "running validation commands"],
  },
  agent: { preferred: "manual", reason: "task planner could not parse the model reply" },
  outputFormat: ["a one-line restatement of the task for the user to confirm"],
};

function renderRepoSnapshot(repo) {
  if (!repo || !repo.ok) return "No repo loaded.";
  const lines = [`Repo: ${repo.name || "(unknown)"}`];
  if (repo.branch) lines.push(`Branch: ${repo.branch}`);
  const top = (repo.changedFiles || []).slice(0, 30);
  if (top.length) lines.push(`Changed files (top 30):\n${top.map((f) => "  " + f).join("\n")}`);
  return lines.join("\n");
}

async function callOpenAIFast({ system, user }) {
  const key = OPENAI_KEY();
  if (!key) throw new Error("OPENAI_API_KEY missing");
  const model = process.env.OPENAI_MODEL_TASK || "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 700,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.choices?.[0]?.message?.content || "";
}

async function callClaudeFast({ system, user }) {
  const key = ANTHROPIC_KEY();
  if (!key) throw new Error("ANTHROPIC_API_KEY missing");
  const model = process.env.ANTHROPIC_MODEL_TASK || "claude-haiku-4-5-20251001";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 700,
      temperature: 0.2,
      system,
      messages: [{ role: "user", content: user + "\n\nReturn ONLY valid JSON." }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return (json.content || []).map((c) => c.text).filter(Boolean).join("\n");
}

function parseJSON(raw) {
  if (!raw) throw new Error("empty AI response");
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : raw;
  try {
    return JSON.parse(body);
  } catch {
    const s = body.indexOf("{");
    const e = body.lastIndexOf("}");
    if (s >= 0 && e > s) return JSON.parse(body.slice(s, e + 1));
    throw new Error("AI returned non-JSON: " + body.slice(0, 200));
  }
}

function clampValidationCommands(cmds) {
  if (!Array.isArray(cmds)) return [];
  const out = [];
  for (const raw of cmds) {
    const cmd = String(raw || "").trim();
    if (!cmd) continue;
    if (getCommandBlockReason(cmd) == null) out.push(cmd);
  }
  return out;
}

function makeId() {
  return `task_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
}

function assembleTask({ llmPart, repo, targetBranch }) {
  const repoBlock = {
    name: (repo && repo.name) || "(unknown)",
    path: (repo && repo.root) || (repo && repo.path) || "",
    baseBranch: (repo && repo.branch) || "main",
    targetBranch: targetBranch || (repo && repo.branch) || "main",
  };
  return {
    id: makeId(),
    repo: repoBlock,
    ...llmPart,
    validationCommands: clampValidationCommands(llmPart.validationCommands),
  };
}

/**
 * Create a strict VmaxTask from a user prompt + optional repo snapshot.
 * Returns { ok, task, parseWarning?, error? }. Never throws — a failed parse
 * yields a safe fallback task and `parseWarning: true` so the renderer can
 * still surface "Task ready (with a warning), approve?".
 *
 * @param {object} args
 * @param {string} args.prompt          User's freeform request.
 * @param {object} [args.repo]          Output of utils/repoContext.scanRepo, or null.
 * @param {string} [args.targetBranch]  Optional explicit target branch.
 */
async function createVmaxTask({ prompt, repo, targetBranch } = {}) {
  const text = String(prompt || "").trim();
  if (!text) return { ok: false, error: "empty prompt" };

  const user = `User request:\n${text.slice(0, 4000)}\n\n--- Repo snapshot ---\n${renderRepoSnapshot(repo)}`;

  let raw;
  try {
    raw = ANTHROPIC_KEY() && !OPENAI_KEY()
      ? await callClaudeFast({ system: SYSTEM_PROMPT, user })
      : await callOpenAIFast({ system: SYSTEM_PROMPT, user });
  } catch (err) {
    const task = assembleTask({ llmPart: FALLBACK_LLM_PART, repo, targetBranch });
    return { ok: false, task, parseWarning: true, error: String((err && err.message) || err) };
  }

  let obj;
  try {
    obj = parseJSON(raw);
  } catch (err) {
    const task = assembleTask({ llmPart: FALLBACK_LLM_PART, repo, targetBranch });
    return { ok: false, task, parseWarning: true, error: String((err && err.message) || err) };
  }

  const parsed = VmaxTaskLLMPartSchema.safeParse(obj);
  if (!parsed.success) {
    const task = assembleTask({ llmPart: FALLBACK_LLM_PART, repo, targetBranch });
    return {
      ok: false,
      task,
      parseWarning: true,
      error: parsed.error.issues.map((i) => `${i.path.join(".") || "root"}: ${i.message}`).join("; "),
    };
  }

  const task = assembleTask({ llmPart: parsed.data, repo, targetBranch });
  // Final guard — the assembled task must satisfy the full schema.
  const final = VmaxTaskSchema.safeParse(task);
  if (!final.success) {
    return {
      ok: false,
      task,
      parseWarning: true,
      error: final.error.issues.map((i) => `${i.path.join(".") || "root"}: ${i.message}`).join("; "),
    };
  }

  return { ok: true, task: final.data };
}

module.exports = {
  VmaxTaskSchema,
  VmaxTaskLLMPartSchema,
  TaskTypeEnum,
  PriorityEnum,
  RiskEnum,
  AgentEnum,
  createVmaxTask,
};
