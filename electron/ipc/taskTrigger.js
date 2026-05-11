// Vmax: trigger one agent for a VmaxTask and track the lifecycle.
//
// Lifecycle: created → routed → triggered → running → completed
//                                                  ↘ failed
//
// Inputs come from utils/taskSchema.js (VmaxTask). The renderer hands us a
// validated task; we pick exactly one agent (preferring task.agent.preferred,
// falling back to the same heuristic dispatch.js uses for raw prompts), build
// a structured prompt payload, spawn the agent, and broadcast `task:status`
// to every window so the UI can render selected agent / status / errors.

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { ipcMain, clipboard, systemPreferences } = require("electron");

const { readState } = require("../state.js");
const { sleep } = require("../utils.js");
const { runApplescriptFile, cursorPasteApplescript } = require("../applescript.js");
const { sendToCommandCenter, sendToOverlay } = require("../ipcBus.js");
const { runners, friendlyClaudeError, friendlyCodexError } = require("./runners.js");
const { CURSOR_CLIPBOARD_SAFETY_FOOTER } = require("../../utils/commandSafety.js");
const { routeAgent } = require("./dispatch.js");
const { VmaxTaskSchema } = require("../../utils/taskSchema.js");

/** In-memory store of task execution records, keyed by task.id. */
const tasks = new Map();

function now() { return Date.now(); }

/**
 * Pick exactly one agent for this task.
 *  - Prefer `task.agent.preferred` when set and not "manual".
 *  - Otherwise fall back to the same heuristic the freeform dispatcher uses.
 *  - "manual" means we should NOT trigger — the user has to act.
 */
function pickAgent(task) {
  const map = { claude_code: "claude", cursor: "cursor", codex: "codex" };
  const pref = task && task.agent && task.agent.preferred;
  if (pref === "manual") {
    return { agent: null, reason: "task asks for manual handling — no agent triggered" };
  }
  if (pref && map[pref]) {
    return {
      agent: map[pref],
      reason: (task.agent.reason && String(task.agent.reason).trim()) || `task.agent.preferred=${pref}`,
    };
  }
  const fallback = routeAgent(`${task?.title || ""} ${task?.goal || ""}`);
  return { agent: fallback.agent, reason: `fallback router: ${fallback.reason}` };
}

/** Render a deterministic structured prompt the agent receives verbatim. */
function buildPromptPayload(task) {
  const lines = [];
  lines.push(`# Task: ${task.title}`);
  lines.push(`ID: ${task.id}`);
  lines.push(`Type: ${task.type}  •  Priority: ${task.priority}  •  Risk: ${task.riskLevel}`);
  if (task.repo && task.repo.name) {
    lines.push(`Repo: ${task.repo.name} (branch ${task.repo.targetBranch || task.repo.baseBranch || "main"})`);
  }
  lines.push("");
  lines.push("## Goal");
  lines.push(task.goal);
  if (task.filesToInspect && task.filesToInspect.length) {
    lines.push("");
    lines.push("## Files to inspect first");
    for (const f of task.filesToInspect) lines.push(`- ${f}`);
  }
  if (task.constraints && task.constraints.length) {
    lines.push("");
    lines.push("## Constraints");
    for (const c of task.constraints) lines.push(`- ${c}`);
  }
  if (task.successCriteria && task.successCriteria.length) {
    lines.push("");
    lines.push("## Success criteria (what the user will see working)");
    for (const s of task.successCriteria) lines.push(`- ${s}`);
  }
  if (task.validationCommands && task.validationCommands.length) {
    lines.push("");
    lines.push("## Verify after edits (Vmax allowlist only — do not run anything else)");
    for (const v of task.validationCommands) lines.push(`- \`${v}\``);
  }
  if (task.outputFormat && task.outputFormat.length) {
    lines.push("");
    lines.push("## Output format");
    for (const o of task.outputFormat) lines.push(`- ${o}`);
  }
  if (task.approvalPolicy && task.approvalPolicy.requireApprovalBefore && task.approvalPolicy.requireApprovalBefore.length) {
    lines.push("");
    lines.push("## STOP and ask the user before:");
    for (const a of task.approvalPolicy.requireApprovalBefore) lines.push(`- ${a}`);
  }
  return lines.join("\n");
}

function snapshot(rec) {
  if (!rec) return null;
  return {
    taskId: rec.task.id,
    task: rec.task,
    selectedAgent: rec.selectedAgent,
    routingReason: rec.routingReason,
    promptPayload: rec.promptPayload,
    status: rec.status,
    error: rec.error,
    runId: rec.runId,
    code: rec.code,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}

function setStatus(rec, status, extra = {}) {
  rec.status = status;
  if (Object.prototype.hasOwnProperty.call(extra, "error")) rec.error = extra.error || null;
  if (Object.prototype.hasOwnProperty.call(extra, "code")) rec.code = extra.code;
  rec.updatedAt = now();
  const payload = snapshot(rec);
  sendToOverlay("task:status", payload);
  sendToCommandCenter("task:status", payload);
}

function spawnClaude({ rec, repoPath, prompt }) {
  const exe = process.env.CLAUDE_BIN || "claude";
  const child = spawn(exe, ["-p", prompt.slice(0, 200_000)], {
    cwd: repoPath,
    env: { ...process.env, FORCE_COLOR: "0" },
    shell: false,
  });
  runners.set(rec.runId, child);
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d.toString()));
  child.once("spawn", () => setStatus(rec, "running"));
  child.on("close", (code) => {
    runners.delete(rec.runId);
    if (code === 0) setStatus(rec, "completed", { code });
    else setStatus(rec, "failed", { code, error: stderr.slice(-2000) || `exit ${code}` });
  });
  child.on("error", (err) => {
    runners.delete(rec.runId);
    setStatus(rec, "failed", { error: friendlyClaudeError(err) });
  });
}

function spawnCodex({ rec, repoPath, prompt }) {
  const exe = process.env.CODEX_BIN || "codex";
  const subcmd = process.env.CODEX_SUBCMD || "exec";
  const args = subcmd ? [subcmd, prompt.slice(0, 200_000)] : [prompt.slice(0, 200_000)];
  const child = spawn(exe, args, {
    cwd: repoPath,
    env: { ...process.env, FORCE_COLOR: "0" },
    shell: false,
  });
  runners.set(rec.runId, child);
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d.toString()));
  child.once("spawn", () => setStatus(rec, "running"));
  child.on("close", (code) => {
    runners.delete(rec.runId);
    if (code === 0) setStatus(rec, "completed", { code });
    else setStatus(rec, "failed", { code, error: stderr.slice(-2000) || `exit ${code}` });
  });
  child.on("error", (err) => {
    runners.delete(rec.runId);
    setStatus(rec, "failed", { error: friendlyCodexError(err) });
  });
}

async function triggerCursor({ rec, repoPath, prompt }) {
  if (process.platform !== "darwin") {
    setStatus(rec, "failed", { error: "Cursor auto-send only works on macOS" });
    return;
  }
  if (!systemPreferences.isTrustedAccessibilityClient(false)) {
    systemPreferences.isTrustedAccessibilityClient(true);
    setStatus(rec, "failed", { error: "Grant Accessibility permission to Electron, then relaunch" });
    return;
  }
  try {
    clipboard.writeText(prompt + CURSOR_CLIPBOARD_SAFETY_FOOTER);
    setStatus(rec, "running");
    await sleep(220);
    await new Promise((resolve) => {
      const c = spawn("open", ["-a", "Cursor", repoPath], { detached: true, stdio: "ignore" });
      c.on("error", () => resolve());
      c.on("spawn", () => { c.unref(); resolve(); });
    });
    await sleep(750);
    let r = await runApplescriptFile(cursorPasteApplescript("i"));
    if (r.code !== 0) r = await runApplescriptFile(cursorPasteApplescript("l"));
    if (r.code === 0) setStatus(rec, "completed", { code: 0 });
    else setStatus(rec, "failed", { error: r.stderr || "Cursor automation failed; prompt is on the clipboard" });
  } catch (err) {
    setStatus(rec, "failed", { error: String((err && err.message) || err) });
  }
}

function register() {
  ipcMain.handle("task:trigger", async (_evt, payload) => {
    const task = payload && payload.task;
    // Validate up-front — we don't trust the renderer to give us a clean shape.
    const parsed = VmaxTaskSchema.safeParse(task);
    if (!parsed.success) {
      return {
        ok: false,
        error: "invalid task shape: " + parsed.error.issues.map((i) => `${i.path.join(".") || "root"}: ${i.message}`).join("; "),
      };
    }
    const clean = parsed.data;

    const repoPath = (clean.repo && clean.repo.path) || readState().lastRepo || "";
    if (!repoPath || !fs.existsSync(path.join(repoPath, ".git"))) {
      const rec = {
        task: clean,
        selectedAgent: null,
        routingReason: "no repo",
        promptPayload: "",
        status: "failed",
        error: "no repo selected — pick one in the Command Center first",
        runId: null,
        code: null,
        createdAt: now(),
        updatedAt: now(),
      };
      tasks.set(clean.id, rec);
      sendToOverlay("task:status", snapshot(rec));
      sendToCommandCenter("task:status", snapshot(rec));
      return { ok: false, taskId: clean.id, status: "failed", error: rec.error };
    }

    const rec = {
      task: clean,
      selectedAgent: null,
      routingReason: "",
      promptPayload: "",
      status: "created",
      error: null,
      runId: `task-${clean.id}-${Math.random().toString(36).slice(2, 7)}`,
      code: null,
      createdAt: now(),
      updatedAt: now(),
    };
    tasks.set(clean.id, rec);
    setStatus(rec, "created");

    const { agent, reason } = pickAgent(clean);
    rec.selectedAgent = agent;
    rec.routingReason = reason;

    if (!agent) {
      // task.agent.preferred === "manual" → don't fire anything. UI still gets
      // a useful state to render the "needs manual" card.
      setStatus(rec, "failed", { error: reason });
      return { ok: false, taskId: clean.id, status: "failed", selectedAgent: null, routingReason: reason, error: reason };
    }

    rec.promptPayload = buildPromptPayload(clean);
    setStatus(rec, "routed");

    try {
      if (agent === "claude") {
        spawnClaude({ rec, repoPath, prompt: rec.promptPayload });
      } else if (agent === "codex") {
        spawnCodex({ rec, repoPath, prompt: rec.promptPayload });
      } else if (agent === "cursor") {
        // Cursor is async (applescript paste); status flows through setStatus there.
        void triggerCursor({ rec, repoPath, prompt: rec.promptPayload });
      } else {
        setStatus(rec, "failed", { error: `unknown agent: ${agent}` });
        return { ok: false, taskId: clean.id, status: "failed", error: `unknown agent: ${agent}` };
      }
      setStatus(rec, "triggered");
      return {
        ok: true,
        taskId: clean.id,
        selectedAgent: agent,
        routingReason: reason,
        status: rec.status,
        runId: rec.runId,
      };
    } catch (err) {
      const msg = String((err && err.message) || err);
      setStatus(rec, "failed", { error: msg });
      return { ok: false, taskId: clean.id, status: "failed", selectedAgent: agent, routingReason: reason, error: msg };
    }
  });

  ipcMain.handle("task:get", (_evt, taskId) => {
    const rec = tasks.get(String(taskId || ""));
    return rec ? snapshot(rec) : null;
  });

  ipcMain.handle("task:list", () => Array.from(tasks.values()).map(snapshot));

  ipcMain.handle("task:cancel", (_evt, taskId) => {
    const rec = tasks.get(String(taskId || ""));
    if (!rec || !rec.runId) return false;
    const child = runners.get(rec.runId);
    if (!child) return false;
    child.kill("SIGTERM");
    return true;
  });
}

module.exports = { register, pickAgent, buildPromptPayload };
