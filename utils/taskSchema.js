// Vmax strict task schema + a small/fast HTTP call to the FastAPI backend.
//
// Hard cutover: the LLM call lives on the server (POST /v1/task in
// backend/app/routes/task.py). This module is now:
//   1. The Zod schema for VmaxTask + enums — kept on the client because
//      electron/ipc/taskTrigger.js still re-validates tasks defensively
//      before acting on them.
//   2. A thin HTTP wrapper around POST /v1/task that preserves the
//      previous {ok, task?, parseWarning?, error?} return shape so
//      callers (electron/ipc/ai.js → ai:task) don't need to change.
//
// The backend is repo-agnostic: only the prompt is sent. The returned
// VmaxTask still has a `repo` block on it (placeholder values from the
// server) and taskTrigger.js fills in the real repo path from
// readState().lastRepo when it actually spawns the agent.
//
// When the backend is unreachable we deliberately do NOT fabricate a
// VmaxTask on the client — the renderer just gets `{ ok: false, error }`
// so it can show a "backend is down" placeholder instead of a fake
// "Task ready" card.

const { z } = require("zod");

const BACKEND_URL =
  (process.env.VMAX_BACKEND_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");

// /v1/task is intentionally short-budget on the server (max_tokens=700,
// cheap model). We give the HTTP call a slightly longer ceiling than
// the JS-only path used to use, but still small relative to /v1/ask.
const REQUEST_TIMEOUT_MS = 15_000;

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

async function postTask(body) {
  const url = `${BACKEND_URL}/v1/task`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(`Vmax backend unreachable at ${BACKEND_URL}: ${err.message || err}`);
  }
  clearTimeout(timer);

  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      detail = j?.detail || JSON.stringify(j);
    } catch {
      try { detail = await res.text(); } catch { /* ignore */ }
    }
    throw new Error(`Vmax backend ${res.status}: ${detail || res.statusText}`);
  }
  return res.json();
}

/**
 * Create a strict VmaxTask from a user prompt.
 *
 * The backend is repo-agnostic — only the prompt is sent. The Electron
 * host substitutes its own `lastRepo` from state when it spawns the
 * agent (see electron/ipc/taskTrigger.js).
 *
 * Returns one of:
 *   - `{ ok: true, task }` on success.
 *   - `{ ok: false, task, parseWarning: true, error }` when the server
 *     parsed the LLM reply but final validation flagged something.
 *   - `{ ok: false, error }` (no `task`) when the prompt is empty or
 *     the backend is unreachable. The renderer should treat the
 *     missing `task` as a "backend is down / nothing to approve"
 *     placeholder.
 *
 * Never throws.
 *
 * @param {object} args
 * @param {string} args.prompt  User's freeform request.
 */
async function createVmaxTask({ prompt, repoContextSummary } = {}) {
  const text = String(prompt || "").trim();
  if (!text) return { ok: false, error: "empty prompt" };

  let envelope;
  try {
    envelope = await postTask({
      prompt: text,
      repo_context_summary:
        repoContextSummary && String(repoContextSummary).trim()
          ? String(repoContextSummary).slice(0, 24_000)
          : null,
    });
  } catch (err) {
    // Backend down / network error / non-2xx. Return the error string
    // only — no fabricated task. The renderer reads `ok=false` + no
    // `task` as the "backend is down" placeholder state.
    return {
      ok: false,
      error: String((err && err.message) || err),
    };
  }

  const task = envelope && envelope.task ? envelope.task : null;

  // Empty-prompt path on the server is the only case where `task` is
  // null; the wrapper guarded against that above, so this is mostly
  // defensive against a future server change.
  if (!task) {
    return {
      ok: !!envelope?.ok,
      error: envelope?.error || "backend returned no task",
    };
  }

  // Defensive client-side re-validation. The server already validates,
  // but if it ever drifts we'd rather flag a parseWarning than crash
  // taskTrigger.js (which calls VmaxTaskSchema.safeParse again later).
  const finalCheck = VmaxTaskSchema.safeParse(task);
  if (!finalCheck.success) {
    return {
      ok: false,
      task,
      parseWarning: true,
      error:
        envelope?.error ||
        finalCheck.error.issues
          .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
          .join("; "),
    };
  }

  if (envelope.ok === false) {
    return {
      ok: false,
      task: finalCheck.data,
      parseWarning: !!envelope.parse_warning,
      error: envelope.error || "task validation failed on backend",
    };
  }

  return { ok: true, task: finalCheck.data };
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
