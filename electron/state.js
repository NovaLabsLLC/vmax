// Persisted app state.
//
// One JSON blob in app.getPath("userData") with shape:
//   { profile, settings, onboardedAt, lastRepo, recentRepos, linearWorkspaces? }
// Read/written synchronously — the file is tiny and only touched from main.
//
// Note: there is no longer an applySettingsToEnv helper here. AI keys
// (OPENAI_API_KEY / ANTHROPIC_API_KEY) are owned by the FastAPI backend
// (see backend/.env). The Electron client doesn't need them anymore for
// AI calls — utils/aiClient.js is just an HTTP client now.

const path = require("path");
const fs = require("fs");
const { app } = require("electron");

function statePath() {
  return path.join(app.getPath("userData"), "exec-state.json");
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return {};
  }
}

function writeState(s) {
  try {
    fs.writeFileSync(statePath(), JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

module.exports = { statePath, readState, writeState };
