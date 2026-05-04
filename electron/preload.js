const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("exec", {
  setInteractive: (on) => ipcRenderer.invoke("window:set-interactive", !!on),
  openOverlay: () => ipcRenderer.invoke("exec:open-overlay"),
  closeOverlay: () => ipcRenderer.invoke("exec:close-overlay"),
  focusCommandCenter: () => ipcRenderer.invoke("exec:focus-command-center"),
  getRecentRepos: () => ipcRenderer.invoke("exec:get-recent-repos"),
  getLastRepo: () => ipcRenderer.invoke("exec:get-last-repo"),

  getProfile: () => ipcRenderer.invoke("exec:get-profile"),
  saveProfile: (p) => ipcRenderer.invoke("exec:save-profile", p),
  getSettings: () => ipcRenderer.invoke("exec:get-settings"),
  saveSettings: (s) => ipcRenderer.invoke("exec:save-settings", s),
  isOnboarded: () => ipcRenderer.invoke("exec:is-onboarded"),
  finishOnboarding: () => ipcRenderer.invoke("exec:onboarding-done"),
  rememberRepo: (p) => ipcRenderer.invoke("exec:remember-repo", p),
  pickRepo: () => ipcRenderer.invoke("exec:pick-repo"),
  scanRepo: (repoPath) => ipcRenderer.invoke("exec:scan-repo", repoPath),
  openInCursor: (repoPath) => ipcRenderer.invoke("exec:open-in-cursor", repoPath),
  copy: (text) => ipcRenderer.invoke("exec:copy", text),
  sendToCursorChat: (payload) => ipcRenderer.invoke("exec:send-to-cursor-chat", payload),

  run: (payload) => ipcRenderer.invoke("exec:run", payload),
  cancelRun: (runId) => ipcRenderer.invoke("exec:run:cancel", runId),
  onRunData: (cb) => {
    const handler = (_evt, payload) => cb(payload);
    ipcRenderer.on("exec:run:data", handler);
    return () => ipcRenderer.removeListener("exec:run:data", handler);
  },
  onRunEnd: (cb) => {
    const handler = (_evt, payload) => cb(payload);
    ipcRenderer.on("exec:run:end", handler);
    return () => ipcRenderer.removeListener("exec:run:end", handler);
  },

  plan: (payload) => ipcRenderer.invoke("ai:plan", payload),
  explainFailure: (payload) => ipcRenderer.invoke("ai:explain-failure", payload),
  summarizeDiff: (payload) => ipcRenderer.invoke("ai:summarize-diff", payload),
});
