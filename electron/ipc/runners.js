// Streaming command runners.
//
// All four `exec:run*` handlers share the same wire protocol:
//   exec:run:data  { runId, stream: "stdout"|"stderr"|"meta", chunk }
//   exec:run:end   { runId, code, error? }
// A shared `runners` Map lets `exec:run:cancel` (and ipc/dispatch.js) reach
// in and kill any in-flight child by runId.

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { ipcMain } = require("electron");
const { getCommandBlockReason, EXIT_POLICY_BLOCK } = require("../../utils/commandSafety.js");

const runners = new Map();

function friendlyCodexError(err) {
  const code = err && err.code;
  if (code === "ENOENT") {
    return (
      "Codex CLI not found on PATH. Install: npm i -g @openai/codex "
      + "— then restart Vmax — or set CODEX_BIN to the full path of the codex executable."
    );
  }
  if (code === "EACCES") return "Codex CLI is not executable. Check permissions or set CODEX_BIN.";
  return String((err && err.message) || err);
}

function friendlyClaudeError(err) {
  const code = err && err.code;
  if (code === "ENOENT") {
    return (
      "Claude Code CLI not found on PATH. Install: npm i -g @anthropic-ai/claude-code "
      + "— then restart Vmax — or set CLAUDE_BIN to the full path of the claude executable."
    );
  }
  if (code === "EACCES") {
    return "Claude Code CLI is not executable. Check permissions or set CLAUDE_BIN.";
  }
  return String((err && err.message) || err);
}

function register() {
  // Raw shell command in the selected repo.
  ipcMain.handle("exec:run", (evt, { runId, repoPath, command }) => {
    if (!repoPath || !command) throw new Error("repoPath and command required");

    const blockReason = getCommandBlockReason(command);
    if (blockReason) {
      const send = (channel, payload) => {
        if (!evt.sender.isDestroyed()) evt.sender.send(channel, { runId, ...payload });
      };
      send("exec:run:data", {
        stream: "stderr",
        chunk:
          `\n⛔ Blocked (demo safety)\n${blockReason}\n\nThis command was not executed.\n`,
      });
      send("exec:run:end", { runId, code: EXIT_POLICY_BLOCK, error: blockReason });
      return { started: false, blocked: true, reason: blockReason };
    }

    const child = spawn(command, {
      cwd: repoPath,
      shell: true,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    runners.set(runId, child);
    const send = (channel, payload) => {
      if (!evt.sender.isDestroyed()) evt.sender.send(channel, { runId, ...payload });
    };
    child.stdout.on("data", (d) => send("exec:run:data", { stream: "stdout", chunk: d.toString() }));
    child.stderr.on("data", (d) => send("exec:run:data", { stream: "stderr", chunk: d.toString() }));
    child.on("close", (code) => { runners.delete(runId); send("exec:run:end", { code }); });
    child.on("error", (err) => { runners.delete(runId); send("exec:run:end", { code: -1, error: String(err.message || err) }); });
    return { started: true };
  });

  // OpenClaw CLI bridge.
  ipcMain.handle("exec:openclaw-agent", (evt, { runId, repoPath, message }) => {
    if (!repoPath || !message) throw new Error("repoPath and message required");
    const exe = process.env.OPENCLAW_BIN || "openclaw";
    const timeoutSec = String(process.env.OPENCLAW_TIMEOUT_SEC || "900");
    let msg = String(message);
    const maxArg = 200_000;
    if (msg.length > maxArg) {
      msg = `${msg.slice(0, maxArg)}\n\n[Truncated: message exceeded safe argv size for Vmax bridge]`;
    }
    const args = ["agent"];
    if (process.env.OPENCLAW_AGENT) args.push("--agent", process.env.OPENCLAW_AGENT);
    args.push("--message", msg, "--timeout", timeoutSec);

    const send = (channel, payload) => {
      if (!evt.sender.isDestroyed()) evt.sender.send(channel, { runId, ...payload });
    };

    const child = spawn(exe, args, {
      cwd: repoPath,
      env: { ...process.env, FORCE_COLOR: "0" },
      shell: false,
    });
    runners.set(runId, child);
    child.stdout.on("data", (d) => send("exec:run:data", { stream: "stdout", chunk: d.toString() }));
    child.stderr.on("data", (d) => send("exec:run:data", { stream: "stderr", chunk: d.toString() }));
    child.on("close", (code) => { runners.delete(runId); send("exec:run:end", { code }); });
    child.on("error", (err) => { runners.delete(runId); send("exec:run:end", { code: -1, error: String(err.message || err) }); });
    return { started: true };
  });

  // Claude Code CLI: `claude -p "<prompt>"` in the selected repo (resolved
  // cwd). Streams on exec:run:* — never blocks the UI thread. Resolves
  // { started: false } when the binary is missing or cwd does not exist.
  ipcMain.handle("exec:run-claude-cli", async (evt, { runId, repoPath, prompt }) => {
    if (!repoPath || !prompt) throw new Error("repoPath and prompt required");
    const exe = process.env.CLAUDE_BIN || "claude";
    const cwd = path.resolve(String(repoPath));

    let p = String(prompt);
    const maxArg = 200_000;
    if (p.length > maxArg) {
      p = `${p.slice(0, maxArg)}\n\n[truncated for argv size]`;
    }

    const send = (channel, payload) => {
      if (!evt.sender.isDestroyed()) evt.sender.send(channel, { runId, ...payload });
    };

    if (!fs.existsSync(cwd)) {
      const msg = `Repo directory not found: ${cwd}`;
      send("exec:run:end", { code: -1, error: msg });
      return { started: false, error: msg };
    }

    return await new Promise((resolve) => {
      const child = spawn(exe, ["-p", p], {
        cwd,
        env: { ...process.env, FORCE_COLOR: "0" },
        shell: false,
      });

      const failSpawn = (err) => {
        runners.delete(runId);
        const msg = friendlyClaudeError(err);
        send("exec:run:end", { code: -1, error: msg });
        resolve({ started: false, error: msg });
      };

      child.once("error", failSpawn);

      child.once("spawn", () => {
        child.removeListener("error", failSpawn);
        runners.set(runId, child);
        send("exec:run:data", {
          stream: "meta",
          chunk: `\n$ ${exe} -p "<prompt>"  (cwd: ${cwd})\n`,
        });
        child.stdout.on("data", (d) =>
          send("exec:run:data", { stream: "stdout", chunk: d.toString() }),
        );
        child.stderr.on("data", (d) =>
          send("exec:run:data", { stream: "stderr", chunk: d.toString() }),
        );
        child.on("close", (code) => {
          runners.delete(runId);
          send("exec:run:end", { code });
        });
        child.on("error", (err) => {
          runners.delete(runId);
          send("exec:run:end", { code: -1, error: friendlyClaudeError(err) });
        });
        resolve({ started: true });
      });
    });
  });

  // Codex CLI: mirrors run-claude-cli. Defaults to `codex exec "<prompt>"` —
  // the non-interactive form. Override CODEX_BIN / CODEX_SUBCMD for forks.
  ipcMain.handle("exec:run-codex-cli", async (evt, { runId, repoPath, prompt }) => {
    if (!repoPath || !prompt) throw new Error("repoPath and prompt required");
    const exe = process.env.CODEX_BIN || "codex";
    const subcmd = process.env.CODEX_SUBCMD || "exec";
    const cwd = path.resolve(String(repoPath));

    let p = String(prompt);
    const maxArg = 200_000;
    if (p.length > maxArg) p = `${p.slice(0, maxArg)}\n\n[truncated for argv size]`;

    const send = (channel, payload) => {
      if (!evt.sender.isDestroyed()) evt.sender.send(channel, { runId, ...payload });
    };

    if (!fs.existsSync(cwd)) {
      const msg = `Repo directory not found: ${cwd}`;
      send("exec:run:end", { code: -1, error: msg });
      return { started: false, error: msg };
    }

    return await new Promise((resolve) => {
      const args = subcmd ? [subcmd, p] : [p];
      const child = spawn(exe, args, {
        cwd,
        env: { ...process.env, FORCE_COLOR: "0" },
        shell: false,
      });

      const failSpawn = (err) => {
        runners.delete(runId);
        const msg = friendlyCodexError(err);
        send("exec:run:end", { code: -1, error: msg });
        resolve({ started: false, error: msg });
      };
      child.once("error", failSpawn);

      child.once("spawn", () => {
        child.removeListener("error", failSpawn);
        runners.set(runId, child);
        send("exec:run:data", {
          stream: "meta",
          chunk: `\n$ ${exe} ${subcmd} "<prompt>"  (cwd: ${cwd})\n`,
        });
        child.stdout.on("data", (d) => send("exec:run:data", { stream: "stdout", chunk: d.toString() }));
        child.stderr.on("data", (d) => send("exec:run:data", { stream: "stderr", chunk: d.toString() }));
        child.on("close", (code) => { runners.delete(runId); send("exec:run:end", { code }); });
        child.on("error", (err) => { runners.delete(runId); send("exec:run:end", { code: -1, error: friendlyCodexError(err) }); });
        resolve({ started: true });
      });
    });
  });

  ipcMain.handle("exec:run:cancel", (_evt, runId) => {
    const child = runners.get(runId);
    if (!child) return false;
    child.kill("SIGTERM");
    return true;
  });
}

module.exports = { register, runners, friendlyClaudeError, friendlyCodexError };
