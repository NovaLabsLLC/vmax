// CLI status + guided login/install for Claude Code and Codex CLIs.
//
// Detects whether each binary is installed, makes a best-effort guess at
// auth state (env var OR known credential files), and can trigger a real
// Terminal window running `<bin> login` / `npm install -g <pkg>` so the user
// can complete OAuth without leaving Vmax. macOS-only for the launchers.

const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const { ipcMain } = require("electron");

function execText(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts, shell: false });
    let out = "";
    let err = "";
    child.stdout?.on("data", (d) => (out += d.toString()));
    child.stderr?.on("data", (d) => (err += d.toString()));
    child.once("error", () => resolve({ ok: false, code: -1, out, err }));
    child.once("close", (code) => resolve({ ok: code === 0, code, out, err }));
  });
}

async function detectCli(bin, versionArgs = ["--version"]) {
  const r = await execText(bin, versionArgs);
  if (!r.ok) return { installed: false, authed: false };
  const text = (r.out || r.err || "").trim().split("\n")[0] || "";
  return { installed: true, version: text };
}

// Best-effort auth detection. These CLIs don't expose a clean "auth status"
// command, so we look for credential files they're known to write plus the
// env-var overrides (which are also valid auth).
function detectClaudeAuth() {
  if (process.env.ANTHROPIC_API_KEY) return { authed: true, via: "env" };
  const home = os.homedir();
  const candidates = [
    path.join(home, ".claude", ".credentials.json"),
    path.join(home, ".claude", "credentials.json"),
    path.join(home, ".config", "claude", "credentials.json"),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return { authed: true, via: "file" }; } catch { /* ignore */ }
  }
  return { authed: false };
}

function detectCodexAuth() {
  if (process.env.OPENAI_API_KEY) return { authed: true, via: "env" };
  const home = os.homedir();
  const candidates = [
    path.join(home, ".codex", "auth.json"),
    path.join(home, ".codex", "credentials.json"),
    path.join(home, ".config", "codex", "auth.json"),
    path.join(home, ".config", "codex", "credentials.json"),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return { authed: true, via: "file" }; } catch { /* ignore */ }
  }
  return { authed: false };
}

function register() {
  ipcMain.handle("cli:status", async () => {
    const claudeBin = process.env.CLAUDE_BIN || "claude";
    const codexBin = process.env.CODEX_BIN || "codex";
    const [claude, codex] = await Promise.all([
      detectCli(claudeBin),
      detectCli(codexBin),
    ]);
    if (claude.installed) {
      const a = detectClaudeAuth();
      claude.authed = a.authed;
      claude.authVia = a.via;
    }
    if (codex.installed) {
      const a = detectCodexAuth();
      codex.authed = a.authed;
      codex.authVia = a.via;
    }
    return { claude, codex };
  });

  ipcMain.handle("cli:open-login", async (_evt, { tool } = {}) => {
    if (process.platform !== "darwin") {
      return { ok: false, error: "Guided login is macOS-only for now. Run it manually in a terminal." };
    }
    const cmd = tool === "codex"
      ? (process.env.CODEX_BIN || "codex") + " login"
      : (process.env.CLAUDE_BIN || "claude") + " login";
    // AppleScript double-quotes need to be escaped before being embedded.
    const escaped = cmd.replace(/"/g, '\\"');
    const script = `tell application "Terminal"\n  activate\n  do script "${escaped}"\nend tell`;
    return new Promise((resolve) => {
      const child = spawn("osascript", ["-e", script]);
      let err = "";
      child.stderr.on("data", (d) => (err += d.toString()));
      child.on("close", (code) => resolve({ ok: code === 0, error: code === 0 ? undefined : err.trim() || `osascript exit ${code}` }));
      child.on("error", (e) => resolve({ ok: false, error: String((e && e.message) || e) }));
    });
  });

  ipcMain.handle("cli:open-install", async (_evt, { tool } = {}) => {
    if (process.platform !== "darwin") {
      return { ok: false, error: "Guided install is macOS-only for now." };
    }
    const cmd = tool === "codex"
      ? "npm install -g @openai/codex"
      : "npm install -g @anthropic-ai/claude-code";
    const escaped = cmd.replace(/"/g, '\\"');
    const script = `tell application "Terminal"\n  activate\n  do script "${escaped}"\nend tell`;
    return new Promise((resolve) => {
      const child = spawn("osascript", ["-e", script]);
      let err = "";
      child.stderr.on("data", (d) => (err += d.toString()));
      child.on("close", (code) => resolve({ ok: code === 0, error: code === 0 ? undefined : err.trim() || `osascript exit ${code}` }));
      child.on("error", (e) => resolve({ ok: false, error: String((e && e.message) || e) }));
    });
  });
}

module.exports = { register };
