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
} = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { scanRepo, summarizeDiffText } = require("../utils/repoContext.js");
const { planTask, explainFailure, summarizeDiff } = require("../utils/aiClient.js");

const isDev = process.env.NODE_ENV === "development";
const DEV_URL = "http://localhost:5180";

let commandWindow = null;
let overlayWindow = null;
const runners = new Map();

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
const OVERLAY_HEIGHT = 640;
function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.show();
    overlayWindow.focus();
    return;
  }
  const primary = screen.getPrimaryDisplay();
  const { width, height } = primary.workAreaSize;
  const { x: workX, y: workY } = primary.workArea;

  overlayWindow = new BrowserWindow({
    width,
    height: OVERLAY_HEIGHT,
    x: workX,
    y: workY + height - OVERLAY_HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
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
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  });
  overlayWindow.on("closed", () => (overlayWindow = null));
}

ipcMain.handle("exec:open-overlay", () => createOverlayWindow());
ipcMain.handle("exec:close-overlay", () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
});
ipcMain.handle("exec:focus-command-center", () => createCommandWindow());

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

  clipboard.writeText(String(prompt ?? ""));

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

  const script = `
    delay 0.7
    tell application "Cursor" to activate
    delay 0.5
    tell application "System Events"
      keystroke "l" using {command down}
      delay 0.25
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

ipcMain.handle("exec:run:cancel", (_evt, runId) => {
  const child = runners.get(runId);
  if (!child) return false;
  child.kill("SIGTERM");
  return true;
});

// ---- AI ----
ipcMain.handle("ai:plan", (_evt, payload) => planTask(payload));
ipcMain.handle("ai:explain-failure", (_evt, payload) => explainFailure(payload));
ipcMain.handle("ai:summarize-diff", (_evt, payload) =>
  summarizeDiff({ ...payload, fallback: summarizeDiffText })
);

// ---- lifecycle ----
app.whenReady().then(createCommandWindow);
app.on("activate", () => {
  if (!commandWindow && !overlayWindow) createCommandWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
