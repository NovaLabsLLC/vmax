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
const os = require("os");
const { spawn } = require("child_process");
const { scanRepo, summarizeDiffText } = require("../utils/repoContext.js");
const sessions = require("../utils/sessions.js");
const { createProject } = require("../utils/projects.js");
const {
  planTask,
  explainFailure,
  summarizeDiff,
  transcribeAudio,
  synthesizeSpeech,
  askAssistant,
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
const PILL_WIDTH = 600;
const PILL_HEIGHT = 64;
/** Total overlay content height when Vmax response panel is open (pill + body). */
const OVERLAY_EXPANDED_HEIGHT = 540;
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

ipcMain.handle("pill:interrupt-speech", () => sendToCommandCenter("pill:interrupt-speech"));
ipcMain.handle("pill:transcript", (_evt, text) => sendToCommandCenter("pill:transcript", text));
ipcMain.handle("pill:voice-question", (_evt, text) => sendToCommandCenter("pill:voice-question", text));
ipcMain.handle("pill:request-cursor", () => sendToCommandCenter("pill:request-cursor"));
ipcMain.handle("pill:toggle-screen", () => sendToCommandCenter("pill:toggle-screen"));
ipcMain.handle("workspace:status", (_evt, status) => sendToOverlay("workspace:status", status));
ipcMain.handle("workspace:speaking", (_evt, speaking) => sendToOverlay("workspace:speaking", !!speaking));
ipcMain.handle("overlay:set-caption-open", (_evt, open) => {
  setOverlayCaptionOpen(!!open);
});
ipcMain.on("overlay:set-caption-open-sync", (_evt, open) => {
  setOverlayCaptionOpen(!!open);
});
ipcMain.handle("voice:publish-caption", (_evt, payload) => {
  sendToOverlay("voice:caption", payload || {});
});

ipcMain.handle("overlay:set-expanded", (_evt, { expanded }) => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return false;
  const targetH = expanded ? OVERLAY_EXPANDED_HEIGHT : PILL_HEIGHT;
  const [x, y] = overlayWindow.getPosition();
  const [, curH] = overlayWindow.getContentSize();
  overlayWindow.setContentSize(PILL_WIDTH, targetH);
  overlayWindow.setPosition(x, y + (curH - targetH));
  return true;
});

ipcMain.handle("exec:publish-vmax-response", (_evt, payload) => {
  sendToOverlay("vmax:response", payload || {});
  return true;
});

ipcMain.handle("exec:vmax-panel-action", (_evt, payload) => {
  sendToCommandCenter("vmax-panel:action", payload || {});
  return true;
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
    talkBack: sett.talkBack !== false,
  };
});
ipcMain.handle("exec:save-settings", (_evt, settings) => {
  const s = readState();
  s.settings = { ...(s.settings || {}), ...settings };
  writeState(s);
  applySettingsToEnv();
  const merged = s.settings || {};
  for (const w of [commandWindow, overlayWindow]) {
    if (w && !w.isDestroyed()) {
      try {
        w.webContents.send("exec:settings-updated", merged);
      } catch { /* ignore */ }
    }
  }
  return merged;
});

function broadcastSessionsUpdated() {
  sendToCommandCenter("sessions:updated");
}
ipcMain.handle("sessions:list", () => sessions.list(app));
ipcMain.handle("sessions:get", (_evt, id) => sessions.get(app, id));
ipcMain.handle("sessions:save", (_evt, s) => {
  const out = sessions.save(app, s);
  broadcastSessionsUpdated();
  return out;
});
ipcMain.handle("sessions:delete", (_evt, id) => {
  sessions.remove(app, id);
  broadcastSessionsUpdated();
});
ipcMain.handle("sessions:new", (_evt, seed) => {
  const out = sessions.create(app, seed || {});
  broadcastSessionsUpdated();
  return out;
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Run AppleScript from a temp file (more reliable than multiline `osascript -e`). */
function runApplescriptFile(source) {
  const tmp = path.join(os.tmpdir(), `exec-cursor-${process.pid}-${Date.now()}.scpt`);
  fs.writeFileSync(tmp, source.trim() + "\n", "utf8");
  return new Promise((resolve) => {
    const child = spawn("osascript", [tmp]);
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      resolve({ code, stderr });
    });
  });
}

/** Key after ⌘: "i" = Composer/Agent, "l" = Chat pane (fallback). */
function cursorPasteApplescript(openKey) {
  return `
tell application "Cursor" to activate
delay 2.0
tell application "System Events"
  tell process "Cursor"
    set frontmost to true
  end tell
  delay 0.35
  key code 53
  delay 0.25
  keystroke "${openKey}" using {command down}
  delay 1.05
  keystroke "v" using {command down}
  delay 0.45
  key code 36
end tell
`;
}

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
  await sleep(280);

  let openedRepoVia = "none";
  await new Promise((resolve) => {
    const tryRun = (cmd, args) => new Promise((res) => {
      const c = spawn(cmd, args, { detached: true, stdio: "ignore" });
      c.on("error", () => res(false));
      c.on("spawn", () => { c.unref(); res(true); });
    });
    (async () => {
      if (await tryRun("cursor", [repoPath])) {
        openedRepoVia = "cursor-cli";
        return resolve();
      }
      if (await tryRun("open", ["-a", "Cursor", repoPath])) {
        openedRepoVia = "open-app";
        return resolve();
      }
      resolve();
    })();
  });

  await sleep(openedRepoVia === "none" ? 400 : 750);

  const base = { openedRepoVia };
  let first = await runApplescriptFile(cursorPasteApplescript("i"));
  if (first.code !== 0) {
    const second = await runApplescriptFile(cursorPasteApplescript("l"));
    if (second.code === 0) {
      return {
        ok: true,
        pastedVia: "applescript",
        pasteShortcut: "⌘L",
        ...base,
      };
    }
    first = second;
  } else {
    return { ok: true, pastedVia: "applescript", pasteShortcut: "⌘I", ...base };
  }

  let urlOk = false;
  try {
    const pathPart = repoPath.startsWith("/") ? repoPath : `/${repoPath}`;
    await shell.openExternal("cursor://file" + pathPart);
    urlOk = true;
  } catch {
    /* ignore */
  }
  return {
    ok: true,
    pastedVia: "clipboard-only",
    automationFailed: true,
    pasteShortcut: "⌘I+⌘L",
    ...base,
    message: urlOk
      ? "Tried ⌘I and ⌘L automation; clipboard is ready — focus Cursor and press ⌘V in Agent or Chat."
      : first.stderr || "AppleScript failed for ⌘I and ⌘L — prompt is on the clipboard.",
  };
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

// Claude Code CLI: `claude -p "<prompt>"` in the selected repo (resolved cwd).
// Streams on exec:run:* — never blocks the UI thread. Resolves { started: false }
// when the binary is missing or cwd does not exist.
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

ipcMain.handle("exec:run:cancel", (_evt, runId) => {
  const child = runners.get(runId);
  if (!child) return false;
  child.kill("SIGTERM");
  return true;
});

// ---- AI ----
ipcMain.handle("ai:transcribe", (_evt, payload) => transcribeAudio(payload));
ipcMain.handle("ai:tts", (_evt, payload) => synthesizeSpeech(payload));
ipcMain.handle("ai:ask", (_evt, payload) => askAssistant(payload));
ipcMain.handle("exec:create-project", (_evt, payload) => createProject(payload || {}));
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
