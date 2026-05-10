// Persisted app state and API-key merging.
//
// We keep one JSON blob in app.getPath("userData") with shape:
//   { profile, settings, onboardedAt, lastRepo, recentRepos }
// Read/written synchronously — the file is tiny and only touched from main.

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

// API keys: prefer the user's saved settings, fall back to .env. We mutate
// process.env so utils/aiClient.js (which reads keys lazily) sees the merged
// values. Saved settings explicitly override .env, mirroring the original.
function applySettingsToEnv() {
  const s = readState();
  const sett = s.settings || {};
  if (sett.openaiApiKey && !process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = sett.openaiApiKey;
  if (sett.anthropicApiKey && !process.env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = sett.anthropicApiKey;
  if (sett.openaiApiKey) process.env.OPENAI_API_KEY = sett.openaiApiKey;
  if (sett.anthropicApiKey) process.env.ANTHROPIC_API_KEY = sett.anthropicApiKey;
}

module.exports = { statePath, readState, writeState, applySettingsToEnv };
