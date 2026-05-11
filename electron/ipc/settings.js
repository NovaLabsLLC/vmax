// IPC: user profile, app settings, Linear API verify, onboarding flag.
//
// We never echo .env keys back through `exec:get-settings` — only what
// the user explicitly saved. The OPENAI / ANTHROPIC keys saved here are
// inert for Vmax AI itself (the FastAPI backend owns those keys); they
// stay in the schema only so the existing settings UI keeps working.

const { ipcMain } = require("electron");
const { readState, writeState } = require("../state.js");
const { getCommandWindow, getOverlayWindow, createOverlayWindow } = require("../windows.js");
const { verifyLinearApiKey } = require("../../utils/linearApi.js");

function register() {
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
    return {
      openaiApiKey: sett.openaiApiKey || "",
      anthropicApiKey: sett.anthropicApiKey || "",
      linearApiKey: sett.linearApiKey || "",
      cursorAutoSend: sett.cursorAutoSend !== false,
      defaultProvider: sett.defaultProvider || "auto",
      talkBack: sett.talkBack !== false,
    };
  });

  ipcMain.handle("linear:verify", async (_evt, { apiKey } = {}) => {
    try {
      const sett = readState().settings || {};
      const key = String(apiKey ?? sett.linearApiKey ?? "").trim();
      if (!key) return { ok: false, error: "No API key — paste one below or save settings first." };
      const { userName, email } = await verifyLinearApiKey(key);
      return { ok: true, userName, email };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

  ipcMain.handle("exec:save-settings", (_evt, settings) => {
    const s = readState();
    s.settings = { ...(s.settings || {}), ...settings };
    writeState(s);
    const merged = s.settings || {};
    for (const w of [getCommandWindow(), getOverlayWindow()]) {
      if (w && !w.isDestroyed()) {
        try {
          w.webContents.send("exec:settings-updated", merged);
        } catch {
          /* ignore */
        }
      }
    }
    return merged;
  });

  ipcMain.handle("exec:onboarding-done", () => {
    const s = readState();
    s.onboardedAt = Date.now();
    writeState(s);
    // First-run finished — drop into the pill UI and hide the big window.
    createOverlayWindow();
    const cw = getCommandWindow();
    if (cw && !cw.isDestroyed()) cw.hide();
  });
  ipcMain.handle("exec:is-onboarded", () => !!readState().onboardedAt);
}

module.exports = { register };
