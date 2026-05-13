// Vmax: trigger one or more local agents for a VmaxTask and track lifecycle.
//
// Lifecycle: created → routed → triggered → running → completed
//                                                  ↘ failed
//
// Inputs come from utils/taskSchema.js (VmaxTask). The renderer hands us a
// validated task; we pick agents from `payload.agents` when provided, else
// from task.agent.preferred / dispatch heuristic, build a structured prompt
// payload (optionally enriched with repo summary), spawn each agent, and
// broadcast `task:status` per run window so the UI can show multiple rows.
//
// Runs are keyed by `runId` in memory; task:get(taskId) returns the latest run
// for that task.id. task:cancel kills all subprocess-backed runs for a task.

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { ipcMain, app, systemPreferences, clipboard } = require("electron");

const usageStats = require("../utils/usageStats.js");
const { readState } = require("../state.js");
const { sleep, augmentCliPathEnv } = require("../utils.js");
const { tryCursorComposerPasteAttempts } = require("../applescript.js");
const { sendToCommandCenter, sendToOverlay, broadcastRunData, broadcastRunEnd } = require("../ipcBus.js");
const { runners, friendlyClaudeError, friendlyCodexError } = require("./runners.js");
const { CURSOR_CLIPBOARD_SAFETY_FOOTER } = require("../../utils/commandSafety.js");
const { openRepoInCursor } = require("../openCursorWorkspace.js");
const { routeAgent } = require("./dispatch.js");
const { VmaxTaskSchema } = require("../../utils/taskSchema.js");

/** In-memory store keyed by runId — multiple runs may share task.id */
const taskRuns = new Map();

function now() { return Date.now(); }

/**
 * Pick exactly one agent for this task (when callers do not pass `agents`).
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

function normalizeTriggerAgent(name) {
  const s = String(name || "").trim().toLowerCase().replace(/-/g, "_");
  if (s === "claude" || s === "claude_code") return "claude";
  if (s === "codex") return "codex";
  if (s === "cursor") return "cursor";
  return null;
}

/**
 * Explicit `agents: [...]` selects N local runners (deduped).
 * Omit or empty array → single-agent pickAgent path.
 */
function resolveAgentDecisions(payload, task) {
  const raw = payload && payload.agents;
  if (Array.isArray(raw) && raw.length > 0) {
    const out = [];
    const seen = new Set();
    for (const x of raw) {
      const ag = normalizeTriggerAgent(x);
      if (ag && !seen.has(ag)) {
        seen.add(ag);
        out.push({ agent: ag, reason: `requested: ${String(x)}` });
      }
    }
    if (out.length > 0) return { ok: true, decisions: out };
    return {
      ok: false,
      error:
        'no valid agents in `agents[]` — use "claude", "codex", or "cursor" (or omit for automatic routing)',
    };
  }
  const one = pickAgent(task);
  if (!one.agent) return { ok: false, error: one.reason };
  return { ok: true, decisions: [{ agent: one.agent, reason: one.reason }] };
}

function attachRepoPath(taskObj, repoPathResolved) {
  const p = String(repoPathResolved || "").trim();
  if (!p) return taskObj;
  return {
    ...taskObj,
    repo: {
      ...taskObj.repo,
      path: p,
      name: taskObj.repo.name || path.basename(p),
    },
  };
}

/** Render a deterministic structured prompt the agent receives verbatim. */
function buildPromptPayload(task, extras) {
  const ext = extras && typeof extras === "object" ? extras : {};
  const repoSummaryExtra = typeof ext.repoSummary === "string" ? ext.repoSummary.trim() : "";
  const lines = [];
  lines.push(`# Task: ${task.title}`);
  lines.push(`ID: ${task.id}`);
  lines.push(`Type: ${task.type}  •  Priority: ${task.priority}  •  Risk: ${task.riskLevel}`);
  if (task.repo && task.repo.name) {
    lines.push(`Repo: ${task.repo.name} (branch ${task.repo.targetBranch || task.repo.baseBranch || "main"})`);
    if (task.repo.path) lines.push(`Root: ${task.repo.path}`);
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
  if (repoSummaryExtra) {
    lines.push("");
    lines.push("## Attached repository context");
    lines.push(repoSummaryExtra);
  }
  return lines.join("\n");
}

function taskAgentEnv() {
  return { ...augmentCliPathEnv(process.env), FORCE_COLOR: "0" };
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

function latestRunForTask(taskId) {
  const tid = String(taskId || "");
  let best = null;
  for (const rec of taskRuns.values()) {
    if (rec.task.id !== tid) continue;
    if (!best || rec.updatedAt > best.updatedAt) best = rec;
  }
  return best;
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
    env: taskAgentEnv(),
    shell: false,
  });
  const { runId } = rec;
  runners.set(runId, child);
  let stderr = "";
  let streamEnded = false;
  const finishRunWire = (code, error) => {
    if (streamEnded) return;
    streamEnded = true;
    const c = typeof code === "number" && !Number.isNaN(code) ? code : -1;
    broadcastRunEnd(runId, c, error);
  };
  child.stdout.on("data", (d) => broadcastRunData(runId, "stdout", d.toString()));
  child.stderr.on("data", (d) => {
    const chunk = d.toString();
    stderr += chunk;
    broadcastRunData(runId, "stderr", chunk);
  });
  child.once("spawn", () => setStatus(rec, "running"));
  child.on("close", (code) => {
    runners.delete(runId);
    const c = code === null || code === undefined ? -1 : code;
    if (code === 0) {
      setStatus(rec, "completed", { code: c });
      finishRunWire(c);
    } else {
      const errMsg = stderr.slice(-2000) || `exit ${c}`;
      setStatus(rec, "failed", { code: c, error: errMsg });
      finishRunWire(c, errMsg);
    }
  });
  child.on("error", (err) => {
    runners.delete(runId);
    const msg = friendlyClaudeError(err);
    setStatus(rec, "failed", { error: msg });
    finishRunWire(-1, msg);
  });
}

function spawnCodex({ rec, repoPath, prompt }) {
  const exe = process.env.CODEX_BIN || "codex";
  const subcmd = process.env.CODEX_SUBCMD || "exec";
  const args = subcmd ? [subcmd, prompt.slice(0, 200_000)] : [prompt.slice(0, 200_000)];
  const child = spawn(exe, args, {
    cwd: repoPath,
    env: taskAgentEnv(),
    shell: false,
  });
  const { runId } = rec;
  runners.set(runId, child);
  let stderr = "";
  let streamEnded = false;
  const finishRunWire = (code, error) => {
    if (streamEnded) return;
    streamEnded = true;
    const c = typeof code === "number" && !Number.isNaN(code) ? code : -1;
    broadcastRunEnd(runId, c, error);
  };
  child.stdout.on("data", (d) => broadcastRunData(runId, "stdout", d.toString()));
  child.stderr.on("data", (d) => {
    const chunk = d.toString();
    stderr += chunk;
    broadcastRunData(runId, "stderr", chunk);
  });
  child.once("spawn", () => setStatus(rec, "running"));
  child.on("close", (code) => {
    runners.delete(runId);
    const c = code === null || code === undefined ? -1 : code;
    if (code === 0) {
      setStatus(rec, "completed", { code: c });
      finishRunWire(c);
    } else {
      const errMsg = stderr.slice(-2000) || `exit ${c}`;
      setStatus(rec, "failed", { code: c, error: errMsg });
      finishRunWire(c, errMsg);
    }
  });
  child.on("error", (err) => {
    runners.delete(runId);
    const msg = friendlyCodexError(err);
    setStatus(rec, "failed", { error: msg });
    finishRunWire(-1, msg);
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
    const { openedVia } = await openRepoInCursor(repoPath);
    await sleep(openedVia === "none" ? 450 : 800);
    const auto = await tryCursorComposerPasteAttempts();
    if (auto) setStatus(rec, "completed", { code: 0 });
    else setStatus(rec, "failed", { error: "Cursor automation failed; prompt is on the clipboard" });
  } catch (err) {
    setStatus(rec, "failed", { error: String((err && err.message) || err) });
  }
}

function dispatchAgent(agent, ctx) {
  if (agent === "claude") {
    spawnClaude(ctx);
  } else if (agent === "codex") {
    spawnCodex(ctx);
  } else if (agent === "cursor") {
    void triggerCursor(ctx);
  } else {
    setStatus(ctx.rec, "failed", { error: `unknown agent: ${agent}` });
  }
}

function register() {
  ipcMain.handle("task:trigger", async (_evt, payload) => {
    const task = payload && payload.task;
    const parsed = VmaxTaskSchema.safeParse(task);
    if (!parsed.success) {
      return {
        ok: false,
        error:
          "invalid task shape: " + parsed.error.issues.map((i) => `${i.path.join(".") || "root"}: ${i.message}`).join("; "),
      };
    }
    const clean = parsed.data;

    const repoFromPayload =
      payload && payload.repoPath !== undefined && payload.repoPath !== null
        ? String(payload.repoPath).trim()
        : "";
    const repoFromTask = clean.repo && clean.repo.path ? String(clean.repo.path).trim() : "";
    const repoPathResolved = repoFromPayload || repoFromTask || String(readState().lastRepo || "").trim();

    const workingTask = attachRepoPath(clean, repoPathResolved);
    const repoSummary =
      (payload && payload.repoSummary !== undefined && payload.repoSummary !== null && String(payload.repoSummary).trim()) || "";

    if (!repoPathResolved || !fs.existsSync(path.join(repoPathResolved, ".git"))) {
      const runId = `task-${clean.id}-norepo-${Math.random().toString(36).slice(2, 7)}`;
      const rec = {
        task: workingTask,
        selectedAgent: null,
        routingReason: "no repo",
        promptPayload: "",
        status: "failed",
        error: "no repo selected — pick one in the Command Center first",
        runId,
        code: null,
        createdAt: now(),
        updatedAt: now(),
      };
      taskRuns.set(runId, rec);
      setStatus(rec, "failed", { error: rec.error });
      usageStats.record(app, "structured_task_fail", { ok: false });
      return { ok: false, taskId: clean.id, status: "failed", error: rec.error };
    }

    const resolved = resolveAgentDecisions(payload, workingTask);
    if (!resolved.ok) {
      const runId = `task-${workingTask.id}-noroute-${Math.random().toString(36).slice(2, 7)}`;
      const rec = {
        task: workingTask,
        selectedAgent: null,
        routingReason: "no agent",
        promptPayload: "",
        status: "failed",
        error: resolved.error,
        runId,
        code: null,
        createdAt: now(),
        updatedAt: now(),
      };
      taskRuns.set(runId, rec);
      setStatus(rec, "failed", { error: resolved.error });
      usageStats.record(app, "structured_task_fail", { ok: false });
      return {
        ok: false,
        taskId: workingTask.id,
        status: "failed",
        selectedAgent: null,
        routingReason: resolved.error,
        error: resolved.error,
        runs: [{ runId, selectedAgent: null, routingReason: resolved.error, status: "failed" }],
      };
    }

    const promptPayload = buildPromptPayload(workingTask, { repoSummary });

    /** @type {Record<string, string> | null} */
    let promptOverrides = null;
    const pb = payload && payload.promptByAgent;
    if (pb && typeof pb === "object" && !Array.isArray(pb)) {
      promptOverrides = {};
      const keysForLog = [];
      for (const [rawK, rawV] of Object.entries(pb)) {
        const agentKey = normalizeTriggerAgent(rawK);
        const val = typeof rawV === "string" ? rawV.trim() : "";
        if (!agentKey || !val) continue;
        promptOverrides[agentKey] = val.slice(0, 200_000);
        keysForLog.push(agentKey);
      }
      if (!Object.keys(promptOverrides).length) {
        promptOverrides = null;
      } else if (keysForLog.length) {
        console.log(`[task:trigger] per-agent prompts: ${keysForLog.join(", ")}`);
      }
    }
    if (resolved.decisions.length > 1) {
      console.log(
        `[task:trigger] structured parallel (${resolved.decisions.length}): ${resolved.decisions
          .map((d) => d.agent)
          .join(", ")}`,
      );
    }

    /** @type {{ runId: string; selectedAgent: string | null; routingReason: string; status: string }[]} */
    const runsOut = [];
    let lastErr;

    for (const { agent, reason } of resolved.decisions) {
      const runId = `task-${workingTask.id}-${agent}-${Math.random().toString(36).slice(2, 7)}`;
      const dispatched =
        promptOverrides && typeof promptOverrides[agent] === "string" && promptOverrides[agent].trim()
          ? promptOverrides[agent]
          : promptPayload;
      const rec = {
        task: workingTask,
        selectedAgent: agent,
        routingReason: reason,
        promptPayload: dispatched,
        status: "created",
        error: null,
        runId,
        code: null,
        createdAt: now(),
        updatedAt: now(),
      };
      taskRuns.set(runId, rec);
      setStatus(rec, "created");
      setStatus(rec, "routed");

      try {
        if (!["claude", "codex", "cursor"].includes(agent)) {
          setStatus(rec, "failed", { error: `unknown agent: ${agent}` });
          runsOut.push({ runId: rec.runId, selectedAgent: agent, routingReason: reason, status: rec.status });
          lastErr = lastErr || `unknown agent: ${agent}`;
          continue;
        }
        dispatchAgent(agent, { rec, repoPath: repoPathResolved, prompt: dispatched });
        setStatus(rec, "triggered");
        runsOut.push({
          runId: rec.runId,
          selectedAgent: agent,
          routingReason: reason,
          status: rec.status,
        });
      } catch (err) {
        const msg = String((err && err.message) || err);
        setStatus(rec, "failed", { error: msg });
        runsOut.push({
          runId: rec.runId,
          selectedAgent: agent,
          routingReason: reason,
          status: "failed",
        });
        lastErr = lastErr || msg;
      }
    }

    const first = resolved.decisions[0];
    const multi = resolved.decisions.length > 1;
    const ok = runsOut.some((r) => r.status === "triggered");
    const triggeredAgents = runsOut
      .filter((r) => r.status === "triggered")
      .map((r) => r.selectedAgent)
      .filter(Boolean);
    if (ok) {
      usageStats.record(app, "structured_task_ok", {
        agents: triggeredAgents,
        taskId: workingTask.id,
        ok: true,
      });
    } else {
      usageStats.record(app, "structured_task_fail", {
        taskId: workingTask.id,
        ok: false,
      });
    }
    return {
      ok,
      taskId: workingTask.id,
      selectedAgent: multi ? null : first.agent,
      routingReason: multi ? `parallel: ${resolved.decisions.map((d) => d.agent).join(", ")}` : first.reason,
      status: ok ? "triggered" : "failed",
      runId: runsOut[0]?.runId,
      runs: runsOut,
      error: ok ? undefined : (lastErr || "no agents started"),
    };
  });

  ipcMain.handle("task:get", (_evt, taskId) => {
    const rec = latestRunForTask(String(taskId || ""));
    return rec ? snapshot(rec) : null;
  });

  ipcMain.handle("task:list", () =>
    Array.from(taskRuns.values())
      .map(snapshot)
      .sort((a, b) => b.updatedAt - a.updatedAt),
  );

  ipcMain.handle("task:cancel", (_evt, taskId) => {
    const tid = String(taskId || "").trim();
    if (!tid) return false;
    let killed = false;
    for (const rec of taskRuns.values()) {
      if (rec.task.id !== tid) continue;
      if (!rec.runId) continue;
      const child = runners.get(rec.runId);
      if (child) {
        child.kill("SIGTERM");
        killed = true;
      }
    }
    return killed;
  });
}

module.exports = { register, pickAgent, buildPromptPayload };
