// File-backed session store. Each session = a chat: a task, the plan/failure/
// diff results that came from it, talk-back bubbles, and the active repo.
// Sessions live in userData/exec-sessions.json so they survive restarts.

const path = require("path");
const fs = require("fs");

function file(app) {
  return path.join(app.getPath("userData"), "exec-sessions.json");
}
function readAll(app) {
  try { return JSON.parse(fs.readFileSync(file(app), "utf8")); }
  catch { return { sessions: [] }; }
}
function writeAll(app, data) {
  try { fs.writeFileSync(file(app), JSON.stringify(data, null, 2)); } catch {}
}

function list(app) {
  return (readAll(app).sessions || [])
    .map((s) => ({
      id: s.id,
      title: s.title || "Untitled",
      updatedAt: s.updatedAt || 0,
      createdAt: s.createdAt || 0,
      repoName: s.repoName || null,
      repoPath: s.repoPath || null,
    }))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function get(app, id) {
  return (readAll(app).sessions || []).find((s) => s.id === id) || null;
}

function save(app, session) {
  if (!session || !session.id) throw new Error("session.id required");
  const data = readAll(app);
  const arr = data.sessions || [];
  const idx = arr.findIndex((s) => s.id === session.id);
  const now = Date.now();
  const merged = {
    ...(idx >= 0 ? arr[idx] : {}),
    ...session,
    updatedAt: now,
    createdAt: idx >= 0 ? arr[idx].createdAt || now : now,
  };
  if (idx >= 0) arr[idx] = merged;
  else arr.unshift(merged);
  // Cap to 100 sessions; trim oldest.
  data.sessions = arr.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 100);
  writeAll(app, data);
  return merged;
}

function remove(app, id) {
  const data = readAll(app);
  data.sessions = (data.sessions || []).filter((s) => s.id !== id);
  writeAll(app, data);
}

function create(app, seed = {}) {
  const id = "s-" + Math.random().toString(36).slice(2, 10);
  const now = Date.now();
  const session = {
    id,
    title: seed.title || "New chat",
    createdAt: now,
    updatedAt: now,
    task: "",
    plan: null,
    failure: null,
    diffSummary: null,
    bubbles: [],
    repoPath: seed.repoPath || null,
    repoName: seed.repoName || null,
  };
  return save(app, session);
}

module.exports = { list, get, save, remove, create };
