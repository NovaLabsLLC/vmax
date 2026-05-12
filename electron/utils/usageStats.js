// Local usage counters — stored in userData/exec-usage.json (no network).
// Kept coarse-grained counts only (no prompt text).

const path = require("path");
const fs = require("fs");

const VALID_AGENTS = new Set(["claude", "codex", "cursor"]);
const MAX_DAILY_BUCKETS = 120;
const MAX_RECENT = 60;

function file(app) {
  return path.join(app.getPath("userData"), "exec-usage.json");
}

function read(app) {
  try {
    const raw = JSON.parse(fs.readFileSync(file(app), "utf8"));
    if (!raw || typeof raw !== "object") throw new Error("bad shape");
    return {
      version: 1,
      updatedAt: Number(raw.updatedAt) || 0,
      totals: typeof raw.totals === "object" && raw.totals ? raw.totals : {},
      byAgent: typeof raw.byAgent === "object" && raw.byAgent ? raw.byAgent : {},
      byDay: typeof raw.byDay === "object" && raw.byDay ? raw.byDay : {},
      recent: Array.isArray(raw.recent) ? raw.recent : [],
    };
  } catch {
    return {
      version: 1,
      updatedAt: 0,
      totals: {},
      byAgent: { claude: 0, codex: 0, cursor: 0 },
      byDay: {},
      recent: [],
    };
  }
}

function write(app, data) {
  try {
    fs.writeFileSync(file(app), JSON.stringify(data, null, 2));
  } catch {
    /* best-effort */
  }
}

function dayKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function bumpAgent(data, agent) {
  const a = String(agent || "").toLowerCase();
  if (!VALID_AGENTS.has(a)) return;
  data.byAgent[a] = (Number(data.byAgent[a]) || 0) + 1;
}

function bumpAgents(data, agents) {
  if (!Array.isArray(agents)) return;
  for (const x of agents) bumpAgent(data, x);
}

function trimRecent(data) {
  data.recent = data.recent.slice(0, MAX_RECENT);
}

function trimDays(data) {
  const keys = Object.keys(data.byDay).sort();
  while (keys.length > MAX_DAILY_BUCKETS) {
    delete data.byDay[keys.shift()];
  }
}

/**
 * @param {import("electron").App} app
 * @param {string} kind — event name (incremented under totals[kind])
 * @param {{ agent?: string, agents?: string[], taskId?: string, ok?: boolean }} [detail]
 */
function record(app, kind, detail = {}) {
  if (!kind) return;
  const data = read(app);
  const ts = Date.now();
  data.updatedAt = ts;
  data.totals[kind] = (Number(data.totals[kind]) || 0) + 1;

  const dk = dayKey(ts);
  if (!data.byDay[dk]) data.byDay[dk] = {};
  data.byDay[dk][kind] = (Number(data.byDay[dk][kind]) || 0) + 1;

  if (detail.agent) bumpAgent(data, detail.agent);
  if (detail.agents) bumpAgents(data, detail.agents);

  const stub = {
    ts,
    kind,
    ...(typeof detail.ok === "boolean" ? { ok: detail.ok } : {}),
    ...(detail.taskId ? { taskId: String(detail.taskId).slice(0, 24) } : {}),
    ...(detail.agent ? { agent: detail.agent } : {}),
    ...(detail.agents && detail.agents.length ? { agents: detail.agents.slice(0, 12) } : {}),
  };
  data.recent.unshift(stub);
  trimRecent(data);
  trimDays(data);
  write(app, data);
}

function summary(app) {
  return read(app);
}

module.exports = { record, summary, VALID_AGENTS };
