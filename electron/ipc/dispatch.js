// Vmax router: pick the right coding agent for a prompt and fire it.
//
// Classification lives in utils/agentIntent.js (no LLM). Heuristic tiers:
//   • explicit • repo / infra / multi-step / routing & ipc tooling → Claude • local edit → Cursor
//   • read/explain/trace → Codex • default Claude agentic fallback.
//
// Status is broadcast on `agents:status` so every window can render the live chip state.
//
// Dual (or triple) splits: callers may send `<<<VMAX:AGENT:*>>>` blocks inside `prompt`,
// or pass `{ agentPrompts: [{ agent, prompt }, …] }` (≥2 agents, deduped). Ignores `forcedAgent`
// when a multi split resolves.

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { ipcMain, clipboard, systemPreferences, app } = require("electron");
const usageStats = require("../utils/usageStats.js");
const { readState } = require("../state.js");
const { sleep, augmentCliPathEnv } = require("../utils.js");
const { tryCursorComposerPasteAttempts } = require("../applescript.js");
const { sendToOverlay, sendToCommandCenter, broadcastRunData, broadcastRunEnd } = require("../ipcBus.js");
const { runners, friendlyClaudeError, friendlyCodexError } = require("./runners.js");
const { CURSOR_CLIPBOARD_SAFETY_FOOTER } = require("../../utils/commandSafety.js");
const { routeAgentIntent } = require("../utils/agentIntent.js");
const { openRepoInCursor } = require("../openCursorWorkspace.js");

/** @param {string} rawPrompt intent classification for exec:dispatch + structured-task fallback routing */
function routeAgent(rawPrompt) {
  return routeAgentIntent(rawPrompt);
}

function normalizeDispatchAgent(raw) {
  const s = String(raw || "").trim().toLowerCase().replace(/-/g, "_");
  if (s === "claude" || s === "claude_code") return "claude";
  if (s === "codex") return "codex";
  if (s === "cursor") return "cursor";
  return null;
}

/**
 * Normalize explicit `{ agentPrompts: [...] }` from preload.
 *
 * @param {unknown} list
 * @returns {{ ok: true; specs: { agent: string; prompt: string; reason?: string }[] } | { ok: false; error: string }}
 */
function coerceExplicitAgentPrompts(list) {
  if (!Array.isArray(list)) {
    return { ok: false, error: "`agentPrompts` must be an array" };
  }
  if (list.length < 2) {
    return { ok: false, error: "`agentPrompts` needs at least two distinct agents with prompts" };
  }
  /** @type { { agent: string; prompt: string; reason?: string }[] } */
  const specs = [];
  const seen = new Set();
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const agent = normalizeDispatchAgent(item && item.agent);
    const pr = item && typeof item.prompt === "string" ? item.prompt.trim() : "";
    if (!agent || !pr) {
      return { ok: false, error: `agentPrompts[${i}] needs a valid agent and non-empty prompt` };
    }
    if (seen.has(agent)) {
      return { ok: false, error: `duplicate agent in agentPrompts: ${agent}` };
    }
    seen.add(agent);
    const reasonMaybe =
      item && typeof item.reason === "string" && item.reason.trim() ? item.reason.trim() : undefined;
    const row = /** @type { { agent: string; prompt: string; reason?: string } } */ ({ agent, prompt: pr });
    if (reasonMaybe) row.reason = reasonMaybe;
    specs.push(row);
  }
  if (specs.length < 2) {
    return { ok: false, error: "`agentPrompts` resolves to fewer than two agents" };
  }
  return { ok: true, specs };
}

/**
 * Spawn one runner (broadcasts agents:status, registers run telemetry).
 *
 * @param {string} repoPath
 * @param {{ agent: string; promptText: string; reason?: string }} spec
 */
function startPillAgentDispatch(repoPath, spec) {
  const { agent } = spec;
  const promptText = String(spec.promptText || "").trim();
  const reason =
    typeof spec.reason === "string" && spec.reason.trim()
      ? spec.reason.trim()
      : "dual-dispatch";

  const runId = `dispatch-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  function broadcast(state, extra = {}) {
    const payload = { agent, state, runId, prompt: promptText, reason, ...extra };
    sendToOverlay("agents:status", payload);
    sendToCommandCenter("agents:status", payload);
  }

  broadcast("running");
  usageStats.record(app, "pill_dispatch", { agent });

  const cliEnv = { ...augmentCliPathEnv(process.env), FORCE_COLOR: "0" };

  try {
    if (agent === "claude") {
      const exe = process.env.CLAUDE_BIN || "claude";
      const slice = promptText.slice(0, 200_000);
      const child = spawn(exe, ["-p", slice], {
        cwd: repoPath,
        env: cliEnv,
        shell: false,
        // Non-interactive — close stdin so Claude doesn't wait for EOF.
        stdio: ["ignore", "pipe", "pipe"],
      });
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
      child.on("close", (code) => {
        runners.delete(runId);
        const c = code === null || code === undefined ? -1 : code;
        if (code === 0) {
          broadcast("done", { code: c });
          finishRunWire(c);
        } else {
          const errMsg = stderr.slice(-2000) || `exit ${c}`;
          broadcast("error", { code: c, error: errMsg });
          finishRunWire(c, errMsg);
        }
      });
      child.on("error", (err) => {
        runners.delete(runId);
        const msg = friendlyClaudeError(err);
        broadcast("error", { error: msg });
        finishRunWire(-1, msg);
      });
    } else if (agent === "codex") {
      const exe = process.env.CODEX_BIN || "codex";
      const subcmd = process.env.CODEX_SUBCMD || "exec";
      const slice = promptText.slice(0, 200_000);
      const args = subcmd ? [subcmd, slice] : [slice];
      const child = spawn(exe, args, {
        cwd: repoPath,
        env: cliEnv,
        shell: false,
        // Non-interactive — close stdin so `codex exec` doesn't hang on
        // "Reading additional input from stdin…".
        stdio: ["ignore", "pipe", "pipe"],
      });
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
      child.on("close", (code) => {
        runners.delete(runId);
        const c = code === null || code === undefined ? -1 : code;
        if (code === 0) {
          broadcast("done", { code: c });
          finishRunWire(c);
        } else {
          const errMsg = stderr.slice(-2000) || `exit ${c}`;
          broadcast("error", { code: c, error: errMsg });
          finishRunWire(c, errMsg);
        }
      });
      child.on("error", (err) => {
        runners.delete(runId);
        const msg = friendlyCodexError(err);
        broadcast("error", { error: msg });
        finishRunWire(-1, msg);
      });
    } else if (agent === "cursor") {
      (async () => {
        try {
          if (process.platform !== "darwin") {
            broadcast("error", { error: "Cursor auto-send only works on macOS" });
            return;
          }
          if (!systemPreferences.isTrustedAccessibilityClient(false)) {
            systemPreferences.isTrustedAccessibilityClient(true);
            broadcast("error", { error: "Grant Accessibility permission to Electron, then relaunch" });
            return;
          }
          clipboard.writeText(promptText + CURSOR_CLIPBOARD_SAFETY_FOOTER);
          await sleep(220);
          const { openedVia } = await openRepoInCursor(repoPath);
          await sleep(openedVia === "none" ? 450 : 800);
          const auto = await tryCursorComposerPasteAttempts();
          if (auto) broadcast("done");
          else {
            broadcast("error", {
              error:
                "Cursor shortcuts failed — prompt copied. Focus Cursor Composer (⌘I) or Chat (⌘L) and press ⌘V.",
            });
          }
        } catch (err) {
          broadcast("error", { error: String((err && err.message) || err) });
        }
      })();
    } else {
      broadcast("error", { error: `unknown agent ${agent}` });
    }
  } catch (err) {
    broadcast("error", { error: String((err && err.message) || err) });
  }

  return runId;
}

function register() {
  ipcMain.handle("exec:dispatch", async (_evt, payload = {}) => {
    const repoPath = readState().lastRepo;
    const text = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
    const forcedAgentRaw = payload.agent;

    if (!repoPath || !fs.existsSync(path.join(repoPath, ".git"))) {
      return { ok: false, error: "no repo selected — pick one in the Command Center first" };
    }

    const explicitKeyPresent =
      payload && Object.prototype.hasOwnProperty.call(payload, "agentPrompts");

    if (explicitKeyPresent && payload.agentPrompts != null && payload.agentPrompts !== "") {
      const coerced = coerceExplicitAgentPrompts(payload.agentPrompts);
      if (!coerced.ok) {
        return { ok: false, error: coerced.error };
      }
      console.log(
        `[exec:dispatch] multi-agent (explicit): ${coerced.specs.map((s) => s.agent).join(", ")}`,
      );
      /** @type { { agent: string; reason?: string; runId: string }[] } */
      const runsMeta = [];
      for (let i = 0; i < coerced.specs.length; i++) {
        const s = coerced.specs[i];
        const runId = startPillAgentDispatch(repoPath, {
          agent: s.agent,
          promptText: s.prompt,
          reason: s.reason || `explicit split ${i + 1}/${coerced.specs.length}`,
        });
        runsMeta.push({ agent: s.agent, reason: s.reason, runId });
      }
      return {
        ok: true,
        mode: "multi",
        agent: runsMeta[0].agent,
        reason: runsMeta.map((r) => r.agent).join("+"),
        runId: runsMeta[0].runId,
        runs: runsMeta,
      };
    }

    const delimSplit = parsePillDualAgentPrompts(text);
    if (delimSplit && delimSplit.length >= 2) {
      console.log(
        `[exec:dispatch] multi-agent (delimiter): ${delimSplit.map((s) => s.agent).join(", ")}`,
      );
      /** @type { { agent: string; reason?: string; runId: string }[] } */
      const runsMeta = [];
      const n = delimSplit.length;
      for (let i = 0; i < n; i++) {
        const s = delimSplit[i];
        const runId = startPillAgentDispatch(repoPath, {
          agent: s.agent,
          promptText: s.prompt,
          reason: `pill-marker split ${i + 1}/${n}`,
        });
        runsMeta.push({ agent: s.agent, runId });
      }
      return {
        ok: true,
        mode: "multi",
        agent: runsMeta[0].agent,
        reason: delimSplit.map((s) => s.agent).join("+"),
        runId: runsMeta[0].runId,
        runs: runsMeta,
      };
    }

    // Single-shot path (backward compatible).

    const promptOnly = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
    if (!promptOnly) {
      return {
        ok: false,
        error: "empty prompt — pass `prompt`, or `{ agentPrompts: [...] }` for multi-agent",
      };
    }

    const decision = forcedAgentRaw
      ? { agent: String(forcedAgentRaw), reason: "forced" }
      : routeAgent(promptOnly);
    const normalized = normalizeDispatchAgent(decision.agent);
    if (!normalized) {
      return { ok: false, error: `unknown agent ${decision.agent}` };
    }
    const reason = typeof decision.reason === "string" ? decision.reason : "router";

    console.log(`[exec:dispatch] single: ${normalized} (${reason})`);

    const runId = startPillAgentDispatch(repoPath, {
      agent: normalized,
      promptText: promptOnly,
      reason,
    });

    return { ok: true, mode: "single", agent: normalized, reason, runId };
  });
}

module.exports = { register, routeAgent };
