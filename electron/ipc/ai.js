// AI IPC: speech ↔ text, ask, plan, explain failures, summarize diffs, and
// project scaffolding. All thin wrappers over utils/aiClient.js so the
// renderer can call into Anthropic/OpenAI without holding API keys.

const { ipcMain } = require("electron");
const {
  planTask,
  explainFailure,
  summarizeDiff,
  transcribeAudio,
  synthesizeSpeech,
  askAssistant,
} = require("../../utils/aiClient.js");
const { summarizeDiffText } = require("../../utils/repoContext.js");
const { createProject } = require("../../utils/projects.js");

function register() {
  ipcMain.handle("ai:transcribe", (_evt, payload) => transcribeAudio(payload));
  ipcMain.handle("ai:tts", (_evt, payload) => synthesizeSpeech(payload));
  ipcMain.handle("ai:ask", (_evt, payload) => askAssistant(payload));
  ipcMain.handle("exec:create-project", (_evt, payload) => createProject(payload || {}));
  ipcMain.handle("ai:plan", (_evt, payload) => planTask(payload));
  ipcMain.handle("ai:explain-failure", (_evt, payload) => explainFailure(payload));
  ipcMain.handle("ai:summarize-diff", (_evt, payload) =>
    summarizeDiff({ ...payload, fallback: summarizeDiffText })
  );
}

module.exports = { register };
