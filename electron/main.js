// Exec — control layer for coding agents.
//
// Two windows:
//   • Command Center: a normal macOS window (traffic lights, opaque). Lists
//     active projects, suggestions, reminders. From here you launch Exec.
//   • Overlay: the transparent always-on-top floating card spawned on demand.
// Both windows share the same React build, routed via the URL hash:
//   #/command  → CommandCenter
//   #/overlay  → OverlayApp

require("dotenv").config();
const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  clipboard,
  shell,
  screen,
  systemPreferences,
  desktopCapturer,
  session,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { scanRepo, summarizeDiffText } = require("../utils/repoContext.js");
const sessions = require("../utils/sessions.js");
const {
  planTask,
  explainFailure,
  summarizeDiff,
  transcribeAudio,
  synthesizeSpeech,
} = require("../utils/aiClient.js");
const { getCommandBlockReason, CURSOR_CLIPBOARD_SAFETY_FOOTER, EXIT_POLICY_BLOCK } = require("../utils/commandSafety.js");

const isDev = process.env.NODE_ENV === "development";
const DEV_URL = "http://localhost:5180";

let commandWindow = null;
let overlayWindow = null;
const runners = new Map();

// One main process → one floating pill. Each extra `electron` / `npm run dev`
// is a separate process with its own `overlayWindow`, so multiple launches
// stack identical pills until you quit the extras.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}
app.on("second-instance", () => {
  if (commandWindow && !commandWindow.isDestroyed()) {
    if (commandWindow.isMinimized()) commandWindow.restore();
    commandWindow.show();
    commandWindow.focus();
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.show();
    overlayWindow.focus();
  }
});

function loadView(win, hash) {
  if (isDev) {
    win.loadURL(`${DEV_URL}/#/${hash}`);
  } else {
    win.loadFile(path.join(__dirname, "../dist/renderer/index.html"), { hash: `/${hash}` });
  }
}

// ---- Command Center window ----
function createCommandWindow() {
  if (commandWindow && !commandWindow.isDestroyed()) {
    commandWindow.show();
    commandWindow.focus();
    return;
  }
  commandWindow = new BrowserWindow({
    width: 920,
    height: 640,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: "#08080a",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  loadView(commandWindow, "command");
  commandWindow.on("closed", () => (commandWindow = null));
}

// ---- Overlay window ----
const PILL_WIDTH = 460;
const PILL_HEIGHT = 64;
/** Extra height above the pill row when the caption / dialogue strip is open */
const OVERLAY_CAPTION_ZONE = 100;

// Caption resize is intentionally a no-op: the overlay stays exactly pill-
// sized. Live status (listening / thinking) is shown by the pill itself
// (status dot, mic active state, shimmer) and by the Workspace tab.
function setOverlayCaptionOpen(_open) {
  /* no-op */
}

function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.show();
    overlayWindow.focus();
    return;
  }
  const primary = screen.getPrimaryDisplay();
  const { width, height } = primary.workAreaSize;
  const { x: workX, y: workY } = primary.workArea;

  // Pill-sized window (not full-screen). Drag-region in the renderer moves
  // the whole window around the screen. Vibrancy paints the entire window
  // as Apple-style glass — adapts to dark/light content behind it.
  overlayWindow = new BrowserWindow({
    width: PILL_WIDTH,
    height: PILL_HEIGHT,
    x: workX + Math.round((width - PILL_WIDTH) / 2),
    y: workY + height - PILL_HEIGHT - 24,
    vibrancy: process.platform === "darwin" ? "fullscreen-ui" : undefined,
    visualEffectState: "active",
    backgroundColor: "#00000000",
    roundedCorners: true,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    focusable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  loadView(overlayWindow, "overlay");

  overlayWindow.once("ready-to-show", () => {
    overlayWindow.show();
  });
  overlayWindow.on("closed", () => (overlayWindow = null));

}

ipcMain.handle("exec:open-overlay", () => createOverlayWindow());
ipcMain.handle("exec:close-overlay", () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
});
ipcMain.handle("exec:focus-command-center", () => createCommandWindow());

// Cross-window bus: the pill emits intents (mic transcript, screen toggle,
// send-to-cursor click) and we forward them to the command center so the
// workspace panel can react.
function sendToCommandCenter(channel, payload) {
  if (commandWindow && !commandWindow.isDestroyed()) {
    commandWindow.webContents.send(channel, payload);
  }
}
function sendToOverlay(channel, payload) {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send(channel, payload);
  }
}

ipcMain.handle("pill:transcript", (_evt, text) => sendToCommandCenter("pill:transcript", text));
ipcMain.handle("pill:voice-question", (_evt, text) => sendToCommandCenter("pill:voice-question", text));
ipcMain.handle("pill:request-cursor", () => sendToCommandCenter("pill:request-cursor"));
ipcMain.handle("pill:toggle-screen", () => sendToCommandCenter("pill:toggle-screen"));
ipcMain.handle("workspace:status", (_evt, status) => sendToOverlay("workspace:status", status));
ipcMain.handle("overlay:set-caption-open", (_evt, open) => {
  setOverlayCaptionOpen(!!open);
});
ipcMain.on("overlay:set-caption-open-sync", (_evt, open) => {
  setOverlayCaptionOpen(!!open);
});
ipcMain.handle("voice:publish-caption", (_evt, payload) => {
  sendToOverlay("voice:caption", payload || {});
});

// Click-through control (overlay only, but harmless for command window)
ipcMain.handle("window:set-interactive", (evt, on) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  if (!win) return;
  if (on) win.setIgnoreMouseEvents(false);
  else win.setIgnoreMouseEvents(true, { forward: true });
});

// ---- persistence ----
function statePath() { return path.join(app.getPath("userData"), "exec-state.json"); }
function readState() { try { return JSON.parse(fs.readFileSync(statePath(), "utf8")); } catch { return {}; } }
function writeState(s) { try { fs.writeFileSync(statePath(), JSON.stringify(s)); } catch {} }

// API keys: prefer the user's saved settings, fall back to .env. We mutate
// process.env at boot so utils/aiClient.js (which reads keys at module load)
// sees the merged values.
function applySettingsToEnv() {
  const s = readState();
  const sett = s.settings || {};
  if (sett.openaiApiKey && !process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = sett.openaiApiKey;
  if (sett.anthropicApiKey && !process.env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = sett.anthropicApiKey;
  // Allow saved settings to override .env if explicitly chosen.
  if (sett.openaiApiKey) process.env.OPENAI_API_KEY = sett.openaiApiKey;
  if (sett.anthropicApiKey) process.env.ANTHROPIC_API_KEY = sett.anthropicApiKey;
}
applySettingsToEnv();

ipcMain.handle("exec:get-profile", () => readState().profile || null);
ipcMain.handle("exec:save-profile", (_evt, profile) => {
  const s = readState();
  s.profile = { ...(s.profile || {}), ...profile };
  writeState(s);
  return s.profile;
});

ipcMain.handle("exec:get-settings", () => {
  const s = readState();
  const sett = s.settings || {};
  // Don't echo .env keys back to the UI as if the user typed them — surface
  // them only when the user has actually saved a key in the app.
  return {
    openaiApiKey: sett.openaiApiKey || "",
    anthropicApiKey: sett.anthropicApiKey || "",
    cursorAutoSend: sett.cursorAutoSend !== false,
    defaultProvider: sett.defaultProvider || "auto",
  };
});
ipcMain.handle("exec:save-settings", (_evt, settings) => {
  const s = readState();
  s.settings = { ...(s.settings || {}), ...settings };
  writeState(s);
  applySettingsToEnv();
  return s.settings;
});

ipcMain.handle("sessions:list", () => sessions.list(app));
ipcMain.handle("sessions:get", (_evt, id) => sessions.get(app, id));
ipcMain.handle("sessions:save", (_evt, s) => sessions.save(app, s));
ipcMain.handle("sessions:delete", (_evt, id) => sessions.remove(app, id));
ipcMain.handle("sessions:new", (_evt, seed) => sessions.create(app, seed || {}));

ipcMain.handle("exec:onboarding-done", () => {
  const s = readState();
  s.onboardedAt = Date.now();
  writeState(s);
});
ipcMain.handle("exec:is-onboarded", () => !!readState().onboardedAt);

ipcMain.handle("exec:get-last-repo", () => {
  const s = readState();
  if (!s.lastRepo) return null;
  if (!fs.existsSync(path.join(s.lastRepo, ".git"))) return null;
  return s.lastRepo;
});

ipcMain.handle("exec:remember-repo", (_evt, repoPath) => {
  const s = readState();
  s.lastRepo = repoPath;
  s.recentRepos = [repoPath, ...((s.recentRepos || []).filter((p) => p !== repoPath))].slice(0, 6);
  writeState(s);
});

ipcMain.handle("exec:get-recent-repos", () => {
  const s = readState();
  return (s.recentRepos || []).filter((p) => fs.existsSync(path.join(p, ".git")));
});

// ---- repo / fs IPC ----
ipcMain.handle("exec:pick-repo", async (evt) => {
  const win = BrowserWindow.fromWebContents(evt.sender) || commandWindow;
  const result = await dialog.showOpenDialog(win, {
    title: "Pick a repo",
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});

ipcMain.handle("exec:scan-repo", (_evt, repoPath) => scanRepo(repoPath));

ipcMain.handle("exec:open-in-cursor", async (_evt, repoPath) => {
  const trySpawn = (cmd, args) => new Promise((resolve) => {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("spawn", () => { child.unref(); resolve(true); });
  });
  if (await trySpawn("cursor", [repoPath])) return { ok: true, via: "cli" };
  if (process.platform === "darwin" && await trySpawn("open", ["-a", "Cursor", repoPath]))
    return { ok: true, via: "open-a" };
  try {
    await shell.openExternal("cursor://file" + (repoPath.startsWith("/") ? repoPath : "/" + repoPath));
    return { ok: true, via: "url" };
  } catch {}
  shell.openPath(repoPath);
  return { ok: false, via: "finder" };
});

ipcMain.handle("exec:copy", (_evt, text) => {
  clipboard.writeText(String(text ?? ""));
  return true;
});

ipcMain.handle("exec:send-to-cursor-chat", async (_evt, { repoPath, prompt }) => {
  if (process.platform !== "darwin")
    return { ok: false, reason: "platform", message: "Auto-send is only wired up on macOS." };

  if (!systemPreferences.isTrustedAccessibilityClient(false)) {
    systemPreferences.isTrustedAccessibilityClient(true);
    return {
      ok: false, reason: "accessibility",
      message: "Grant Accessibility permission to Electron, then quit and run again.",
    };
  }

  clipboard.writeText(String(prompt ?? "") + CURSOR_CLIPBOARD_SAFETY_FOOTER);

  await new Promise((resolve) => {
    const tryRun = (cmd, args) => new Promise((res) => {
      const c = spawn(cmd, args, { detached: true, stdio: "ignore" });
      c.on("error", () => res(false));
      c.on("spawn", () => { c.unref(); res(true); });
    });
    (async () => {
      if (await tryRun("cursor", [repoPath])) return resolve();
      if (await tryRun("open", ["-a", "Cursor", repoPath])) return resolve();
      resolve();
    })();
  });

  // ⌘I opens Cursor's Composer / Agent (the surface that runs autonomous
  // edits). ⌘L opens the simpler Ask / Chat. We default to ⌘I because the
  // user almost always wants the prompt to drive the agent, not just chat.
  const script = `
    delay 0.7
    tell application "Cursor" to activate
    delay 0.5
    tell application "System Events"
      keystroke "i" using {command down}
      delay 0.3
      keystroke "v" using {command down}
      delay 0.2
      key code 36
    end tell
  `;
  return new Promise((resolve) => {
    const child = spawn("osascript", ["-e", script]);
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, reason: "osascript", message: stderr || `osascript exit ${code}` });
    });
  });
});

// ---- streaming command runner ----
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

// Claude Code CLI bridge: spawn `claude -p <prompt>` (no shell, prompt as a
// single argv so we don't have to worry about quoting). Streams stdout/stderr
// over the same exec:run channels so the workspace's existing terminal +
// activity wiring lights up. Missing binary yields a clear error.
ipcMain.handle("exec:run-claude-cli", (evt, { runId, repoPath, prompt }) => {
  if (!repoPath || !prompt) throw new Error("repoPath and prompt required");
  const exe = process.env.CLAUDE_BIN || "claude";

  // Cap argv size — most shells / kernels handle ~256K but be conservative.
  let p = String(prompt);
  const maxArg = 200_000;
  if (p.length > maxArg) {
    p = `${p.slice(0, maxArg)}\n\n[truncated for argv size]`;
  }

  const send = (channel, payload) => {
    if (!evt.sender.isDestroyed()) evt.sender.send(channel, { runId, ...payload });
  };

  send("exec:run:data", { stream: "meta", chunk: `\n$ ${exe} -p <prompt>\n` });

  let child;
  try {
    child = spawn(exe, ["-p", p], {
      cwd: repoPath,
      env: { ...process.env, FORCE_COLOR: "0" },
      shell: false,
    });
  } catch (err) {
    send("exec:run:end", { code: -1, error: friendlyClaudeError(err) });
    return { started: false };
  }
  runners.set(runId, child);
  child.stdout.on("data", (d) => send("exec:run:data", { stream: "stdout", chunk: d.toString() }));
  child.stderr.on("data", (d) => send("exec:run:data", { stream: "stderr", chunk: d.toString() }));
  child.on("close", (code) => { runners.delete(runId); send("exec:run:end", { code }); });
  child.on("error", (err) => {
    runners.delete(runId);
    send("exec:run:end", { code: -1, error: friendlyClaudeError(err) });
  });
  return { started: true };
});

function friendlyClaudeError(err) {
  const code = err && err.code;
  if (code === "ENOENT") {
    return "Claude Code CLI not found on PATH. Install with `npm i -g @anthropic-ai/claude-code` (or set CLAUDE_BIN).";
  }
  return String((err && err.message) || err);
}

ipcMain.handle("exec:run:cancel", (_evt, runId) => {
  const child = runners.get(runId);
  if (!child) return false;
  child.kill("SIGTERM");
  return true;
});

// ---- AI ----
ipcMain.handle("ai:transcribe", (_evt, payload) => transcribeAudio(payload));
ipcMain.handle("ai:tts", (_evt, payload) => synthesizeSpeech(payload));
ipcMain.handle("ai:plan", (_evt, payload) => planTask(payload));
ipcMain.handle("ai:explain-failure", (_evt, payload) => explainFailure(payload));
ipcMain.handle("ai:summarize-diff", (_evt, payload) =>
  summarizeDiff({ ...payload, fallback: summarizeDiffText })
);

// ---- lifecycle ----
app.whenReady().then(() => {
  // Auto-grant the first screen source so navigator.mediaDevices.getDisplayMedia
  // works without an explicit picker. macOS still gates this behind its
  // Screen Recording TCC prompt the first time around.
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const status = process.platform === "darwin"
          ? systemPreferences.getMediaAccessStatus("screen")
          : "granted";
        const sources = await desktopCapturer.getSources({ types: ["screen"] });
        console.log(`[exec] screen tcc=${status} sources=${sources.length}`);
        if (!sources.length) {
          callback({});
          return;
        }
        callback({ video: sources[0] });
      } catch (err) {
        console.error("[exec] desktopCapturer failed:", err);
        callback({});
      }
    },
    // macOS 15+: defer to the system picker, which doesn't depend on the
    // Electron process's stale TCC state. Falls back to the handler above on
    // older macOS / non-darwin.
    { useSystemPicker: true }
  );
  createCommandWindow();
});

ipcMain.handle("perm:screen-status", () => {
  if (process.platform !== "darwin") return "granted";
  return systemPreferences.getMediaAccessStatus("screen");
});
ipcMain.handle("perm:open-screen-prefs", () => {
  shell.openExternal(
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
  );
});
app.on("activate", () => {
  if (!commandWindow && !overlayWindow) createCommandWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
