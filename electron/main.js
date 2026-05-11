// Vmax — control layer for coding agents. Entry point.
//
// Two windows:
//   • Command Center: a normal macOS window (traffic lights, opaque). Lists
//     active projects, suggestions, reminders. From here you launch Vmax.
//   • Overlay: the transparent always-on-top floating pill spawned on
//     demand.
// Both windows share the same React build, routed via the URL hash:
//   #/command  → CommandCenter
//   #/overlay  → OverlayApp
//
// Most logic lives in submodules under ./electron/. This file only owns the
// single-instance lock and wires modules into Electron's ipcMain / lifecycle.

require("dotenv").config();
const { app } = require("electron");

const { getCommandWindow, getOverlayWindow } = require("./windows.js");

// One main process → one floating pill. Each extra `electron` / `npm run
// dev` is a separate process with its own pill, so multiple launches would
// stack identical windows until you quit the extras. Bail out and surface
// the existing windows instead.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}
app.on("second-instance", () => {
  const cw = getCommandWindow();
  if (cw && !cw.isDestroyed()) {
    if (cw.isMinimized()) cw.restore();
    cw.show();
    cw.focus();
  }
  const ow = getOverlayWindow();
  if (ow && !ow.isDestroyed()) {
    ow.show();
    ow.focus();
  }
});

// Wire IPC handlers + lifecycle. Each module registers its own ipcMain
// channels; order between them doesn't matter except that ipcBus.js must
// load before modules that import sendTo* from it (Node's require graph
// handles this automatically as long as ipcBus is required first below).
require("./ipcBus.js").register();
require("./ipc/settings.js").register();
require("./ipc/sessions.js").register();
require("./ipc/repo.js").register();
require("./ipc/cursorBridge.js").register();
require("./ipc/runners.js").register();
require("./ipc/cliStatus.js").register();
require("./ipc/dispatch.js").register();
require("./ipc/taskTrigger.js").register();
require("./ipc/ai.js").register();
require("./ipc/perms.js").register();
require("./lifecycle.js").register();
