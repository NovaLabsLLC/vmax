const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("exec", {
  setInteractive: (on) => ipcRenderer.invoke("window:set-interactive", !!on),
  openOverlay: () => ipcRenderer.invoke("exec:open-overlay"),
  closeOverlay: () => ipcRenderer.invoke("exec:close-overlay"),
  focusCommandCenter: (opts) => ipcRenderer.invoke("exec:focus-command-center", opts || null),
  onCcNavigate: (cb) => {
    const h = (_e, p) => cb(p || {});
    ipcRenderer.on("cc:navigate", h);
    return () => ipcRenderer.removeListener("cc:navigate", h);
  },

  // pill → workspace bus
  pillInterruptSpeech: () => ipcRenderer.invoke("pill:interrupt-speech"),
  pillTranscript: (text) => ipcRenderer.invoke("pill:transcript", text),
  pillVoiceQuestion: (text) => ipcRenderer.invoke("pill:voice-question", text),
  pillLinearDraft: (text) => ipcRenderer.invoke("pill:linear-draft", text),
  pillRequestCursor: () => ipcRenderer.invoke("pill:request-cursor"),
  pillToggleScreen: () => ipcRenderer.invoke("pill:toggle-screen"),
  workspaceStatus: (status) => ipcRenderer.invoke("workspace:status", status),
  workspaceSpeaking: (speaking) => ipcRenderer.invoke("workspace:speaking", !!speaking),
  onWorkspaceSpeaking: (cb) => {
    const h = (_e, speaking) => cb(speaking);
    ipcRenderer.on("workspace:speaking", h);
    return () => ipcRenderer.removeListener("workspace:speaking", h);
  },
  onPillTranscript: (cb) => {
    const h = (_e, text) => cb(text);
    ipcRenderer.on("pill:transcript", h);
    return () => ipcRenderer.removeListener("pill:transcript", h);
  },
  onPillInterruptSpeech: (cb) => {
    const h = () => cb();
    ipcRenderer.on("pill:interrupt-speech", h);
    return () => ipcRenderer.removeListener("pill:interrupt-speech", h);
  },
  onPillVoiceQuestion: (cb) => {
    const h = (_e, text) => cb(text);
    ipcRenderer.on("pill:voice-question", h);
    return () => ipcRenderer.removeListener("pill:voice-question", h);
  },
  onPillLinearDraft: (cb) => {
    const h = (_e, text) => cb(text);
    ipcRenderer.on("pill:linear-draft", h);
    return () => ipcRenderer.removeListener("pill:linear-draft", h);
  },
  onPillRequestCursor: (cb) => {
    const h = () => cb();
    ipcRenderer.on("pill:request-cursor", h);
    return () => ipcRenderer.removeListener("pill:request-cursor", h);
  },
  onPillToggleScreen: (cb) => {
    const h = () => cb();
    ipcRenderer.on("pill:toggle-screen", h);
    return () => ipcRenderer.removeListener("pill:toggle-screen", h);
  },
  onWorkspaceStatus: (cb) => {
    const h = (_e, status) => cb(status);
    ipcRenderer.on("workspace:status", h);
    return () => ipcRenderer.removeListener("workspace:status", h);
  },
  setOverlayCaptionOpen: (open) => ipcRenderer.invoke("overlay:set-caption-open", !!open),
  /** Same as setOverlayCaptionOpen but synchronous — required so the window resizes before the first paint. */
  setOverlayCaptionOpenSync: (open) => {
    ipcRenderer.sendSync("overlay:set-caption-open-sync", !!open);
  },
  publishVoiceCaption: (payload) => ipcRenderer.invoke("voice:publish-caption", payload || {}),
  onVoiceCaption: (cb) => {
    const h = (_e, p) => cb(p || {});
    ipcRenderer.on("voice:caption", h);
    return () => ipcRenderer.removeListener("voice:caption", h);
  },
  publishVmaxResponse: (p) => ipcRenderer.invoke("exec:publish-vmax-response", p),
  onVmaxResponse: (cb) => {
    const h = (_e, p) => cb(p || {});
    ipcRenderer.on("vmax:response", h);
    return () => ipcRenderer.removeListener("vmax:response", h);
  },
  setOverlayExpanded: (expanded) => ipcRenderer.invoke("overlay:set-expanded", { expanded: !!expanded }),
  setOverlayContentHeight: (height) => ipcRenderer.invoke("overlay:set-content-height", { height: Number(height) || 0 }),
  setOverlayToolbarWidth: (width) => ipcRenderer.invoke("overlay:set-toolbar-width", { width: Number(width) || 0 }),
  setOverlayBounds: (opts) =>
    ipcRenderer.invoke("overlay:set-bounds", {
      width: Number(opts?.width) || 0,
      height: Number(opts?.height) || 0,
      animate: !!opts?.animate,
    }),
  openUrl: (url) => ipcRenderer.invoke("exec:open-url", url),
  vmaxPanelAction: (p) => ipcRenderer.invoke("exec:vmax-panel-action", p),
  onVmaxPanelAction: (cb) => {
    const h = (_e, p) => cb(p || {});
    ipcRenderer.on("vmax-panel:action", h);
    return () => ipcRenderer.removeListener("vmax-panel:action", h);
  },
  onCaptionDirection: (cb) => {
    const h = (_e, dir) => cb(dir);
    ipcRenderer.on("overlay:caption-direction", h);
    return () => ipcRenderer.removeListener("overlay:caption-direction", h);
  },
  getRecentRepos: () => ipcRenderer.invoke("exec:get-recent-repos"),
  getLastRepo: () => ipcRenderer.invoke("exec:get-last-repo"),

  getProfile: () => ipcRenderer.invoke("exec:get-profile"),
  saveProfile: (p) => ipcRenderer.invoke("exec:save-profile", p),
  getSettings: () => ipcRenderer.invoke("exec:get-settings"),
  saveSettings: (s) => ipcRenderer.invoke("exec:save-settings", s),

  linearWorkspacesList: () => ipcRenderer.invoke("linear:list"),
  linearWorkspacesAdd: (p) =>
    ipcRenderer.invoke("linear:add", p ?? { apiKey: "", label: "" }),
  linearWorkspacesRemove: (id) => ipcRenderer.invoke("linear:remove", { id }),
  linearWorkspacesRename: (id, label) =>
    ipcRenderer.invoke("linear:rename", { id, label }),
  onLinearWorkspacesChanged: (cb) => {
    const h = () => cb();
    ipcRenderer.on("linear:workspaces-changed", h);
    return () => ipcRenderer.removeListener("linear:workspaces-changed", h);
  },

  onSettingsUpdated: (cb) => {
    const h = (_e, settings) => cb(settings || {});
    ipcRenderer.on("exec:settings-updated", h);
    return () => ipcRenderer.removeListener("exec:settings-updated", h);
  },
  listSessions: () => ipcRenderer.invoke("sessions:list"),
  getSession: (id) => ipcRenderer.invoke("sessions:get", id),
  saveSession: (s) => ipcRenderer.invoke("sessions:save", s),
  deleteSession: (id) => ipcRenderer.invoke("sessions:delete", id),
  clearSessions: () => ipcRenderer.invoke("sessions:clear"),
  newSession: (seed) => ipcRenderer.invoke("sessions:new", seed || {}),
  onSessionsUpdated: (cb) => {
    const h = () => cb();
    ipcRenderer.on("sessions:updated", h);
    return () => ipcRenderer.removeListener("sessions:updated", h);
  },

  isOnboarded: () => ipcRenderer.invoke("exec:is-onboarded"),
  finishOnboarding: () => ipcRenderer.invoke("exec:onboarding-done"),
  rememberRepo: (p) => ipcRenderer.invoke("exec:remember-repo", p),
  pickRepo: () => ipcRenderer.invoke("exec:pick-repo"),
  scanRepo: (repoPath) => ipcRenderer.invoke("exec:scan-repo", repoPath),
  workspaceGitQuickPush: (payload) =>
    ipcRenderer.invoke("exec:workspace-git-quick-push", payload || {}),
  openInCursor: (repoPath) => ipcRenderer.invoke("exec:open-in-cursor", repoPath),
  copy: (text) => ipcRenderer.invoke("exec:copy", text),
  readClipboardText: () => ipcRenderer.invoke("exec:read-clipboard-text"),
  sendToCursorChat: (payload) => ipcRenderer.invoke("exec:send-to-cursor-chat", payload),

  cliStatus: () => ipcRenderer.invoke("cli:status"),
  cliOpenLogin: (tool) => ipcRenderer.invoke("cli:open-login", { tool }),
  cliOpenInstall: (tool) => ipcRenderer.invoke("cli:open-install", { tool }),

  run: (payload) => ipcRenderer.invoke("exec:run", payload),
  openclawAgent: (payload) => ipcRenderer.invoke("exec:openclaw-agent", payload),
  runClaudeCli: (payload) => ipcRenderer.invoke("exec:run-claude-cli", payload),
  runCodexCli: (payload) => ipcRenderer.invoke("exec:run-codex-cli", payload),
  dispatch: (payload) => ipcRenderer.invoke("exec:dispatch", payload),
  onAgentsStatus: (cb) => {
    const h = (_e, p) => cb(p || {});
    ipcRenderer.on("agents:status", h);
    return () => ipcRenderer.removeListener("agents:status", h);
  },
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

  transcribe: (payload) => ipcRenderer.invoke("ai:transcribe", payload),
  tts: (payload) => ipcRenderer.invoke("ai:tts", payload),
  ask: (payload) => ipcRenderer.invoke("ai:ask", payload),
  createProject: (payload) => ipcRenderer.invoke("exec:create-project", payload || {}),
  plan: (payload) => ipcRenderer.invoke("ai:plan", payload),
  taskCreate: (payload) => ipcRenderer.invoke("ai:task", payload),
  taskTrigger: (payload) => ipcRenderer.invoke("task:trigger", payload),
  taskGet: (taskId) => ipcRenderer.invoke("task:get", taskId),
  taskList: () => ipcRenderer.invoke("task:list"),
  /** Local-only counters (`userData/exec-usage.json`): tasks, structured ship, pill dispatch, Cursor. */
  getUsageSummary: () => ipcRenderer.invoke("usage:summary"),
  onUsageUpdated: (cb) => {
    const h = (_e, p) => cb(p || {});
    ipcRenderer.on("usage:updated", h);
    return () => ipcRenderer.removeListener("usage:updated", h);
  },
  taskCancel: (taskId) => ipcRenderer.invoke("task:cancel", taskId),
  onTaskStatus: (cb) => {
    const h = (_e, p) => cb(p || {});
    ipcRenderer.on("task:status", h);
    return () => ipcRenderer.removeListener("task:status", h);
  },
  explainFailure: (payload) => ipcRenderer.invoke("ai:explain-failure", payload),
  summarizeDiff: (payload) => ipcRenderer.invoke("ai:summarize-diff", payload),
});
