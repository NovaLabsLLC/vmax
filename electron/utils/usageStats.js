// Local usage counters — stored in userData/exec-usage.json (no network).
// Kept coarse-grained counts only (no prompt text).

const path = require("path");
const fs = require("fs");

/** Stable UI / quota iteration order (EXE-42). */
const AGENT_ORDER = ["claude", "codex", "cursor"];
const VALID_AGENTS = new Set(AGENT_ORDER);

/** Dispatches counted toward daily quota when usageStats.record bumps an agent. */
const DEFAULT_DAILY_QUOTA_PER_AGENT = 100;

const MAX_DAILY_BUCKETS = 120;
const MAX_RECENT = 60;

function file(app) {
  return path.join(app.getPath("userData"), "exec-usage.json");
}

function read(app) {
  try {
    const raw = JSON.parse(fs.readFileSync(file(app), "utf8"));
    if (!raw || typeof raw !== "object") throw new Error("bad shape");
    const byDayAgent =
      typeof raw.byDayAgent === "object" && raw.byDayAgent ? raw.byDayAgent : {};
    return {
      version: 1,
      updatedAt: Number(raw.updatedAt) || 0,
      totals: typeof raw.totals === "object" && raw.totals ? raw.totals : {},
      byAgent: typeof raw.byAgent === "object" && raw.byAgent ? raw.byAgent : {},
      byDay: typeof raw.byDay === "object" && raw.byDay ? raw.byDay : {},
      byDayAgent,
      recent: Array.isArray(raw.recent) ? raw.recent : [],
    };
  } catch {
    return {
      version: 1,
      updatedAt: 0,
      totals: {},
      byAgent: { claude: 0, codex: 0, cursor: 0 },
      byDay: {},
      byDayAgent: {},
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

function bumpDayAgent(data, ts, agent) {
  const a = String(agent || "").toLowerCase();
  if (!VALID_AGENTS.has(a)) return;
  if (!data.byDayAgent || typeof data.byDayAgent !== "object") data.byDayAgent = {};
  const dk = dayKey(ts);
  if (!data.byDayAgent[dk]) data.byDayAgent[dk] = {};
  data.byDayAgent[dk][a] = (Number(data.byDayAgent[dk][a]) || 0) + 1;
}

function bumpAgents(data, agents) {
  if (!Array.isArray(agents)) return;
  for (const x of agents) bumpAgent(data, x);
}

function bumpAgentsDay(data, ts, agents) {
  if (!Array.isArray(agents)) return;
  for (const x of agents) bumpDayAgent(data, ts, x);
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

function trimDayAgents(data) {
  if (!data.byDayAgent || typeof data.byDayAgent !== "object") return;
  const keys = Object.keys(data.byDayAgent).sort();
  while (keys.length > MAX_DAILY_BUCKETS) {
    delete data.byDayAgent[keys.shift()];
  }
}

/**
 * Daily dispatch quota per agent. Override with env:
 * `VMAX_AGENT_QUOTA_CLAUDE`, `_CODEX`, `_CURSOR` (number or `unlimited`).
 * Fallback: `VMAX_AGENT_QUOTA_DEFAULT`, then {@link DEFAULT_DAILY_QUOTA_PER_AGENT}.
 *
 * @param {string} agentKey
 * @returns {number | null} null = unlimited
 */
function parseQuota(agentKey) {
  const envKey = `VMAX_AGENT_QUOTA_${String(agentKey || "").toUpperCase()}`;
  const raw = process.env[envKey];
  if (raw !== undefined && String(raw).trim() !== "") {
    const t = String(raw).trim().toLowerCase();
    if (t === "unlimited" || t === "none" || t === "inf") return null;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  const defRaw = process.env.VMAX_AGENT_QUOTA_DEFAULT;
  if (defRaw !== undefined && String(defRaw).trim() !== "") {
    const t = String(defRaw).trim().toLowerCase();
    if (t === "unlimited" || t === "none") return null;
    const n = Number(defRaw);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return DEFAULT_DAILY_QUOTA_PER_AGENT;
}

function notifyUsageUpdated() {
  try {
    const { sendToCommandCenter, sendToOverlay } = require("../ipcBus.js");
    const payload = { updatedAt: Date.now() };
    sendToCommandCenter("usage:updated", payload);
    sendToOverlay("usage:updated", payload);
  } catch {
    /* ipcBus may not be wired yet during unusual startups */
  }
}

function buildAgentUsageRows(data) {
  const dk = dayKey(Date.now());
  const today = (data.byDayAgent && data.byDayAgent[dk]) || {};
  const labels = { claude: "Claude", codex: "Codex", cursor: "Cursor" };
  return AGENT_ORDER.map((id) => {
    const totalLifetime = Number(data.byAgent[id]) || 0;
    const totalToday = Number(today[id]) || 0;
    const quotaDaily = parseQuota(id);
    const remainingDaily =
      quotaDaily === null ? null : Math.max(0, quotaDaily - totalToday);
    return {
      id,
      label: labels[id] || id,
      totalLifetime,
      totalToday,
      quotaDaily,
      remainingDaily,
    };
  });
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
  if (detail.agent) bumpDayAgent(data, ts, detail.agent);
  if (detail.agents) bumpAgentsDay(data, ts, detail.agents);

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
  trimDayAgents(data);
  write(app, data);
  notifyUsageUpdated();
}

function summary(app) {
  const data = read(app);
  return {
    ...data,
    agents: buildAgentUsageRows(data),
  };
}

module.exports = { record, summary, VALID_AGENTS, AGENT_ORDER, parseQuota };
