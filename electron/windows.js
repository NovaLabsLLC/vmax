// Window management: the Command Center + the floating overlay pill, plus
// the size clamping / animation helpers the renderer uses to drive the pill.
//
// State lives at module scope (one process → one of each window). Other
// modules read the current windows through getCommandWindow / getOverlayWindow
// rather than holding stale references.

const path = require("path");
const { BrowserWindow, screen } = require("electron");

const isDev = process.env.NODE_ENV === "development";
const DEV_URL = "http://localhost:5180";

let commandWindow = null;
let overlayWindow = null;

function getCommandWindow() {
  return commandWindow;
}

function getOverlayWindow() {
  return overlayWindow;
}

function loadView(win, hash) {
  if (isDev) {
    win.loadURL(`${DEV_URL}/#/${hash}`);
  } else {
    win.loadFile(path.join(__dirname, "../dist/renderer/index.html"), { hash: `/${hash}` });
  }
}

// ---- Command Center window ----
// The Command Center is a hidden background window by default — it only
// exists so voice IPC has somewhere to land. The user-visible UI is the
// floating pill (overlayWindow). Pass { visible: true } to surface it
// (e.g. from the pill's "Vmax" button or onboarding).
function createCommandWindow({ visible = true } = {}) {
  if (commandWindow && !commandWindow.isDestroyed()) {
    if (visible) {
      commandWindow.show();
      commandWindow.focus();
    }
    return;
  }
  commandWindow = new BrowserWindow({
    width: 920,
    height: 640,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: "#08080a",
    show: visible,
    title: "Vmax",
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
/** Minimum / default content width; renderer measures the shell and calls `overlay:set-bounds`. */
const PILL_WIDTH_MIN = 300;
const PILL_WIDTH_DEFAULT = 400;
const PILL_HEIGHT = 56;
/** Absolute floor for clamping — renderer shrinks the overlay to this when minimized. */
const OVERLAY_PUCK_MIN = 80;
/** Upper bound for overlay height (renderer asks for exact size below this). */
const OVERLAY_EXPANDED_HEIGHT = 720;
let overlayPillWidth = PILL_WIDTH_DEFAULT;

function getOverlayPillWidth() {
  return overlayPillWidth;
}

function clampOverlayContentWidth(w) {
  const primary = screen.getPrimaryDisplay();
  const maxByScreen = Math.max(PILL_WIDTH_MIN, primary.workAreaSize.width - 32);
  const maxW = Math.min(1100, maxByScreen);
  const raw = Number(w);
  const n = Math.ceil(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return Math.min(maxW, Math.max(OVERLAY_PUCK_MIN, PILL_WIDTH_DEFAULT));
  }
  return Math.max(OVERLAY_PUCK_MIN, Math.min(maxW, n));
}

function clampOverlayContentHeight(h) {
  const minH = OVERLAY_PUCK_MIN;
  const maxH = OVERLAY_EXPANDED_HEIGHT;
  const raw = Number(h);
  const n = Math.ceil(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return Math.min(maxH, Math.max(minH, PILL_HEIGHT));
  }
  return Math.max(minH, Math.min(maxH, n));
}

/** Keep the bottom edge fixed; horizontal center preserved when width changes. */
function applyOverlayContentSize(nextW, nextH) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const nw = clampOverlayContentWidth(nextW);
  const nh = clampOverlayContentHeight(nextH);
  const [x, y] = overlayWindow.getPosition();
  const [curW, curH] = overlayWindow.getContentSize();
  if (nw === curW && nh === curH) {
    overlayPillWidth = nw;
    return;
  }
  const centerX = x + curW / 2;
  const newX = Math.round(centerX - nw / 2);
  const primary = screen.getPrimaryDisplay();
  const { x: wx, width: ww } = primary.workArea;
  const clampedX = Math.min(Math.max(newX, wx + 8), wx + Math.max(ww - nw - 8, wx + 8));
  overlayPillWidth = nw;
  overlayWindow.setPosition(clampedX, y + (curH - nh));
  overlayWindow.setContentSize(nw, nh);
}

/** @type {ReturnType<typeof setTimeout> | null} */
let overlayBoundsAnimTimer = null;
/** @type {{ w: number; h: number } | null} */
let pendingOverlaySnapBounds = null;

function cancelOverlayBoundsAnimation() {
  if (overlayBoundsAnimTimer) {
    clearTimeout(overlayBoundsAnimTimer);
    overlayBoundsAnimTimer = null;
  }
  pendingOverlaySnapBounds = null;
}

/** Immediate resize; stops any in-flight bounds animation. */
function setOverlayContentSize(nextW, nextH) {
  cancelOverlayBoundsAnimation();
  applyOverlayContentSize(nextW, nextH);
}

const OVERLAY_BOUNDS_ANIM_MS = 300;

/** Snap to size, or queue to end of animation so ResizeObserver updates don't fight the tween. */
function snapOverlayBounds(width, height) {
  const nw = clampOverlayContentWidth(width);
  const nh = clampOverlayContentHeight(height);
  if (overlayBoundsAnimTimer) {
    pendingOverlaySnapBounds = { w: nw, h: nh };
    return;
  }
  applyOverlayContentSize(nw, nh);
}

function animateOverlayBounds(width, height) {
  cancelOverlayBoundsAnimation();
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const targetW = clampOverlayContentWidth(width);
  const targetH = clampOverlayContentHeight(height);
  const [fromW, fromH] = overlayWindow.getContentSize();
  if (Math.abs(fromW - targetW) < 3 && Math.abs(fromH - targetH) < 3) {
    applyOverlayContentSize(targetW, targetH);
    return;
  }
  const start = Date.now();
  const step = () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      overlayBoundsAnimTimer = null;
      return;
    }
    const t = Math.min(1, (Date.now() - start) / OVERLAY_BOUNDS_ANIM_MS);
    const e = 1 - (1 - t) ** 3;
    const w = Math.round(fromW + (targetW - fromW) * e);
    const h = Math.round(fromH + (targetH - fromH) * e);
    applyOverlayContentSize(w, h);
    if (t < 1) {
      overlayBoundsAnimTimer = setTimeout(step, 16);
    } else {
      overlayBoundsAnimTimer = null;
      applyOverlayContentSize(targetW, targetH);
      if (pendingOverlaySnapBounds) {
        const p = pendingOverlaySnapBounds;
        pendingOverlaySnapBounds = null;
        applyOverlayContentSize(p.w, p.h);
      }
    }
  };
  overlayBoundsAnimTimer = setTimeout(step, 0);
}

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
  overlayPillWidth = clampOverlayContentWidth(PILL_WIDTH_DEFAULT);
  const primary = screen.getPrimaryDisplay();
  const { width, height } = primary.workAreaSize;
  const { x: workX, y: workY } = primary.workArea;

  // Pill-sized window (not full-screen). Drag-region in the renderer moves
  // the whole window around the screen. Vibrancy paints the entire window
  // as Apple-style glass — adapts to dark/light content behind it.
  overlayWindow = new BrowserWindow({
    width: overlayPillWidth,
    height: PILL_HEIGHT,
    x: workX + Math.round((width - overlayPillWidth) / 2),
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

module.exports = {
  isDev,
  DEV_URL,
  PILL_WIDTH_MIN,
  PILL_WIDTH_DEFAULT,
  PILL_HEIGHT,
  OVERLAY_EXPANDED_HEIGHT,
  loadView,
  getCommandWindow,
  getOverlayWindow,
  getOverlayPillWidth,
  createCommandWindow,
  createOverlayWindow,
  clampOverlayContentWidth,
  clampOverlayContentHeight,
  setOverlayContentSize,
  snapOverlayBounds,
  animateOverlayBounds,
  setOverlayCaptionOpen,
};
