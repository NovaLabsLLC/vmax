// App lifecycle: boot, screen-recording handler, activate, window-all-closed.
//
// We boot straight into the floating pill. The Command Center is created
// hidden when the user has already onboarded so voice routing IPC still has
// somewhere to land; the pill's "Vmax" button reveals it on demand. On a
// fresh launch the Command Center shows so onboarding can run.

const { app, session, desktopCapturer, systemPreferences } = require("electron");
const {
  createCommandWindow,
  createOverlayWindow,
  getOverlayWindow,
} = require("./windows.js");
const { readState } = require("./state.js");

function register() {
  app.whenReady().then(() => {
    try {
      app.setName("Vmax");
    } catch {
      /* noop */
    }

    // Auto-grant the first screen source so navigator.mediaDevices
    // .getDisplayMedia works without an explicit picker. macOS still gates
    // this behind its Screen Recording TCC prompt the first time around.
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
      // Electron process's stale TCC state. Falls back to the handler above
      // on older macOS / non-darwin.
      { useSystemPicker: true }
    );

    (async () => {
      const onboarded = !!readState().onboardedAt;
      createCommandWindow({ visible: !onboarded });
      if (onboarded) createOverlayWindow();
    })();
  });

  app.on("activate", () => {
    const ow = getOverlayWindow();
    if (!ow || ow.isDestroyed()) createOverlayWindow();
    else {
      ow.show();
      ow.focus();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

module.exports = { register };
