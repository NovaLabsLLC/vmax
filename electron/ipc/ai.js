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
const { summarizeDiffText, scanRepo } = require("../../utils/repoContext.js");
const { createProject } = require("../../utils/projects.js");
const { createVmaxTask } = require("../../utils/taskSchema.js");
const { readState } = require("../state.js");

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

  // Strict VmaxTask creation. The renderer passes `{ prompt }`; we scan the
  // last-active repo here so the model has real file paths to anchor on.
  // Caller can override the repo by passing `{ prompt, repo }`.
  ipcMain.handle("ai:task", async (_evt, payload) => {
    const prompt = String((payload && payload.prompt) || "").trim();
    if (!prompt) return { ok: false, error: "empty prompt" };
    let repo = payload && payload.repo;
    if (!repo) {
      const repoPath = readState().lastRepo;
      if (repoPath) {
        try { repo = await scanRepo(repoPath); } catch { /* swallow — task creation works without repo */ }
      }
    }
    return createVmaxTask({
      prompt,
      repo,
      targetBranch: payload && payload.targetBranch,
    });
  });
}

module.exports = { register };
