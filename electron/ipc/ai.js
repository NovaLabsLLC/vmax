// AI IPC: speech ↔ text, ask, plan, explain failures, summarize diffs, and
// project scaffolding. All thin wrappers over utils/aiClient.js, which is
// now an HTTP client to the FastAPI service in backend/. Model API keys
// live on the server, not in this process.

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
const { createVmaxTask } = require("../../utils/taskSchema.js");

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

  // Strict VmaxTask creation. The renderer just passes `{ prompt }` — the
  // backend is repo-agnostic, and taskTrigger.js fills in the actual repo
  // path from state when it spawns an agent.
  ipcMain.handle("ai:task", (_evt, payload) => {
    const prompt = String((payload && payload.prompt) || "").trim();
    if (!prompt) return { ok: false, error: "empty prompt" };
    const repoContextSummary = (payload && payload.repoContextSummary) || "";
    return createVmaxTask({
      prompt,
      repoContextSummary: String(repoContextSummary || "").trim(),
    });
  });
}

module.exports = { register };
