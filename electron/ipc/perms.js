// macOS Screen Recording (TCC) permission helpers.
//
// The renderer reads the current status via `perm:screen-status`. On a hard
// deny, calling `perm:open-screen-prefs` jumps the user straight into the
// right pane of System Settings so they can toggle Electron on.

const { ipcMain, systemPreferences, shell } = require("electron");

function register() {
  ipcMain.handle("perm:screen-status", () => {
    if (process.platform !== "darwin") return "granted";
    return systemPreferences.getMediaAccessStatus("screen");
  });
  ipcMain.handle("perm:open-screen-prefs", () => {
    shell.openExternal(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
    );
  });
}

module.exports = { register };
