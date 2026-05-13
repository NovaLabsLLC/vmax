// Cross-window IPC bus.
//
// The pill emits intents (mic transcript, screen toggle, send-to-cursor
// click); we forward them to the Command Center so the workspace panel can
// react, and vice-versa for status pushes. All overlay sizing IPC (renderer
// → main) also lives here since it just delegates into windows.js.

const { app, ipcMain, BrowserWindow } = require("electron");
const usageStats = require("./utils/usageStats.js");
const {
  getCommandWindow,
  getOverlayWindow,
  createCommandWindow,
  createOverlayWindow,
  setOverlayCaptionOpen,
  setOverlayContentSize,
  snapOverlayBounds,
  animateOverlayBounds,
  getOverlayPillWidth,
  clampOverlayContentHeight,
  clampOverlayContentWidth,
  PILL_HEIGHT,
  PILL_WIDTH_DEFAULT,
  OVERLAY_EXPANDED_HEIGHT,
} = require("./windows.js");

function sendToCommandCenter(channel, payload) {
  const w = getCommandWindow();
  if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
}

function sendToOverlay(channel, payload) {
  const w = getOverlayWindow();
  if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
}

/** Run transcripts can be large; only the Command Center subscribes (Workspace). */
function broadcastRunData(runId, stream, chunk) {
  sendToCommandCenter("exec:run:data", { runId, stream, chunk });
}

function broadcastRunEnd(runId, code, error) {
  const c = typeof code === "number" && !Number.isNaN(code) ? code : -1;
  const payload = { runId, code: c };
  if (error) payload.error = String(error);
  sendToCommandCenter("exec:run:end", payload);
}

function register() {
  ipcMain.handle("exec:open-overlay", () => createOverlayWindow());
  ipcMain.handle("exec:close-overlay", () => {
    const w = getOverlayWindow();
    if (w && !w.isDestroyed()) w.close();
  });
  ipcMain.handle("exec:focus-command-center", (_evt, opts) => {
    createCommandWindow();
    const view = opts && typeof opts.view === "string" ? opts.view : null;
    if (view) {
      const w = getCommandWindow();
      if (w && !w.isDestroyed()) w.webContents.send("cc:navigate", { view });
    }
  });

  ipcMain.handle("pill:interrupt-speech", () => sendToCommandCenter("pill:interrupt-speech"));
  ipcMain.handle("pill:transcript", (_evt, text) => sendToCommandCenter("pill:transcript", text));
  ipcMain.handle("pill:voice-question", (_evt, text) => sendToCommandCenter("pill:voice-question", text));
  ipcMain.handle("pill:linear-draft", (_evt, text) => sendToCommandCenter("pill:linear-draft", text));
  ipcMain.handle("pill:request-cursor", () => sendToCommandCenter("pill:request-cursor"));
  ipcMain.handle("pill:toggle-screen", () => sendToCommandCenter("pill:toggle-screen"));
  ipcMain.handle("workspace:status", (_evt, status) => sendToOverlay("workspace:status", status));
  ipcMain.handle("workspace:speaking", (_evt, speaking) => sendToOverlay("workspace:speaking", !!speaking));
  ipcMain.handle("overlay:set-caption-open", (_evt, open) => setOverlayCaptionOpen(!!open));
  ipcMain.on("overlay:set-caption-open-sync", (_evt, open) => setOverlayCaptionOpen(!!open));
  ipcMain.handle("voice:publish-caption", (_evt, payload) => sendToOverlay("voice:caption", payload || {}));

  ipcMain.handle("overlay:set-expanded", (_evt, { expanded }) => {
    const overlayWindow = getOverlayWindow();
    if (!overlayWindow || overlayWindow.isDestroyed()) return false;
    // On expand we pick a small starting height. The renderer's ResizeObserver
    // immediately pushes the exact required height via set-content-height, so
    // we don't need to guess large here.
    const targetH = expanded ? Math.min(180, OVERLAY_EXPANDED_HEIGHT) : PILL_HEIGHT;
    const [, curH] = overlayWindow.getContentSize();
    if (targetH === curH) return true;
    setOverlayContentSize(getOverlayPillWidth(), targetH);
    return true;
  });

  // Renderer measures its actual content height and asks the overlay window
  // to match. Bottom edge stays anchored so the pill doesn't jump.
  ipcMain.handle("overlay:set-content-height", (_evt, { height }) => {
    const overlayWindow = getOverlayWindow();
    if (!overlayWindow || overlayWindow.isDestroyed()) return false;
    const targetH = clampOverlayContentHeight(height);
    const [, curH] = overlayWindow.getContentSize();
    if (targetH === curH) return true;
    snapOverlayBounds(getOverlayPillWidth(), targetH);
    return true;
  });

  ipcMain.handle("overlay:set-toolbar-width", (_evt, { width }) => {
    const overlayWindow = getOverlayWindow();
    if (!overlayWindow || overlayWindow.isDestroyed()) return false;
    const targetW = clampOverlayContentWidth(width);
    const [curW, curH] = overlayWindow.getContentSize();
    if (targetW === curW) return true;
    snapOverlayBounds(width, curH);
    return true;
  });

  ipcMain.handle("overlay:set-bounds", (_evt, payload) => {
    const overlayWindow = getOverlayWindow();
    if (!overlayWindow || overlayWindow.isDestroyed()) return false;
    const wIn = Number(payload?.width);
    const hIn = Number(payload?.height);
    const w = clampOverlayContentWidth(
      Number.isFinite(wIn) && wIn > 0 ? wIn : PILL_WIDTH_DEFAULT,
    );
    const h = clampOverlayContentHeight(
      Number.isFinite(hIn) && hIn > 0 ? hIn : PILL_HEIGHT,
    );
    if (payload?.animate) animateOverlayBounds(w, h);
    else snapOverlayBounds(w, h);
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

  // Click-through control (overlay only, but harmless for command window).
  ipcMain.handle("window:set-interactive", (evt, on) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    if (!win) return;
    if (on) win.setIgnoreMouseEvents(false);
    else win.setIgnoreMouseEvents(true, { forward: true });
  });

  ipcMain.handle("usage:summary", () => usageStats.summary(app));
}

module.exports = {
  register,
  sendToCommandCenter,
  sendToOverlay,
  broadcastRunData,
  broadcastRunEnd,
};
