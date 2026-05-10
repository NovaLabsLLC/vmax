// Vmax router: pick the right coding agent for a prompt and fire it.
//
// Heuristic, intentionally fast (no LLM round-trip) so dispatch feels
// instant:
//   • cursor — when the user is asking for in-editor edits to specific files
//     ("edit X", "in @file", "fix the function in foo.ts").
//   • codex  — quick read-only Q&A / explain / search ("what does",
//     "explain", "show me", "find where").
//   • claude — default. Agentic, repo-wide work (Claude Code CLI plans +
//     edits + runs + tests autonomously).
//
// Status is broadcast on `agents:status` so every window can render the live
// chip state.

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

function routeAgent(rawPrompt) {
  const t = String(rawPrompt || "").toLowerCase().trim();
  if (!t) return { agent: "claude", reason: "default" };

  // Explicit override: "use cursor", "send to claude", "via codex", etc.
  const explicit = t.match(/\b(?:use|via|with|on|send to|run in|run on|ask)\s+(cursor|claude|codex)\b/);
  if (explicit) return { agent: explicit[1], reason: "user said so" };

  const isCursorEdit =
    /\b(edit|rename|refactor|inline|extract|move|delete|remove|replace|change|update|modify|fix|patch|tweak)\b/.test(t)
    && (/\b(in|inside|the)\s+@?[\w./-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|cs|cpp|c|rb|php|swift|kt|md|json|yaml|yml|css|html)\b/.test(t)
        || /@[\w./-]+/.test(t)
        || /\bthis (file|function|component|method|class|line|block)\b/.test(t));
  if (isCursorEdit) return { agent: "cursor", reason: "in-editor edit" };

  if (/\b(what|why|how|where|explain|show me|tell me|describe|summarize|find|search|grep|look for|review|audit)\b/.test(t)
      && !/\b(implement|build|create|write|set up|wire|scaffold|generate)\b/.test(t)) {
    return { agent: "codex", reason: "quick Q&A" };
  }

  return { agent: "claude", reason: "agentic execution" };
}

function register() {
  // Single-shot dispatch: pill voice → router → fire selected agent.
  ipcMain.handle("exec:dispatch", async (_evt, { prompt, agent: forcedAgent } = {}) => {
    const text = String(prompt || "").trim();
    if (!text) return { ok: false, error: "empty prompt" };

    const repoPath = readState().lastRepo;
    if (!repoPath || !fs.existsSync(path.join(repoPath, ".git"))) {
      return { ok: false, error: "no repo selected — pick one in the Command Center first" };
    }

    const decision = forcedAgent
      ? { agent: String(forcedAgent), reason: "forced" }
      : routeAgent(text);
    const runId = `dispatch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    function broadcast(state, extra = {}) {
      const payload = { agent: decision.agent, state, runId, prompt: text, reason: decision.reason, ...extra };
      sendToOverlay("agents:status", payload);
      sendToCommandCenter("agents:status", payload);
    }

    broadcast("running");

    try {
      if (decision.agent === "claude") {
        // Reuse the existing claude runner inline. We don't stream output to
        // the pill — agents:status is the source of truth for UI. Output
        // still flows on exec:run:* for any window that wants it.
        const exe = process.env.CLAUDE_BIN || "claude";
        const child = spawn(exe, ["-p", text.slice(0, 200_000)], {
          cwd: repoPath,
          env: { ...process.env, FORCE_COLOR: "0" },
          shell: false,
        });
        runners.set(runId, child);
        let stderr = "";
        child.stderr.on("data", (d) => (stderr += d.toString()));
        child.on("close", (code) => {
          runners.delete(runId);
          if (code === 0) broadcast("done", { code });
          else broadcast("error", { code, error: stderr.slice(-2000) || `exit ${code}` });
        });
        child.on("error", (err) => {
          runners.delete(runId);
          broadcast("error", { error: friendlyClaudeError(err) });
        });
      } else if (decision.agent === "codex") {
        const exe = process.env.CODEX_BIN || "codex";
        const subcmd = process.env.CODEX_SUBCMD || "exec";
        const args = subcmd ? [subcmd, text.slice(0, 200_000)] : [text.slice(0, 200_000)];
        const child = spawn(exe, args, {
          cwd: repoPath,
          env: { ...process.env, FORCE_COLOR: "0" },
          shell: false,
        });
        runners.set(runId, child);
        let stderr = "";
        child.stderr.on("data", (d) => (stderr += d.toString()));
        child.on("close", (code) => {
          runners.delete(runId);
          if (code === 0) broadcast("done", { code });
          else broadcast("error", { code, error: stderr.slice(-2000) || `exit ${code}` });
        });
        child.on("error", (err) => {
          runners.delete(runId);
          broadcast("error", { error: friendlyCodexError(err) });
        });
      } else if (decision.agent === "cursor") {
        // AppleScript paste into Cursor — fire-and-forget. We mark "done"
        // once the paste returns; Cursor itself takes over from there.
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
            clipboard.writeText(text + CURSOR_CLIPBOARD_SAFETY_FOOTER);
            await sleep(220);
            await new Promise((resolve) => {
              const c = spawn("open", ["-a", "Cursor", repoPath], { detached: true, stdio: "ignore" });
              c.on("error", () => resolve());
              c.on("spawn", () => { c.unref(); resolve(); });
            });
            await sleep(750);
            let r = await runApplescriptFile(cursorPasteApplescript("i"));
            if (r.code !== 0) r = await runApplescriptFile(cursorPasteApplescript("l"));
            if (r.code === 0) broadcast("done");
            else broadcast("error", { error: r.stderr || "Cursor automation failed; prompt is on the clipboard" });
          } catch (err) {
            broadcast("error", { error: String((err && err.message) || err) });
          }
        })();
      } else {
        broadcast("error", { error: `unknown agent ${decision.agent}` });
        return { ok: false, error: `unknown agent ${decision.agent}` };
      }
    } catch (err) {
      broadcast("error", { error: String((err && err.message) || err) });
      return { ok: false, error: String((err && err.message) || err) };
    }

    return { ok: true, agent: decision.agent, reason: decision.reason, runId };
  });
}

module.exports = { register, routeAgent };
