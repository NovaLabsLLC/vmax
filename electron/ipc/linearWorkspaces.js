// Linear workspace CRUD with durable storage in exec-state.json (userData).
// Keys are encrypted at rest when safeStorage is available. Successful adds
// / renames mirror to FastAPI `/v1/linear/workspaces*` when the backend is
// reachable so `/v1/ask` shortcuts keep working server-side too.

"use strict";

const crypto = require("crypto");
const { ipcMain, app } = require("electron");
const { readState, writeState } = require("../state.js");
const { sendToCommandCenter, sendToOverlay } = require("../ipcBus.js");
const {
  encryptKeyMaterial,
  decryptKeyMaterial,
  verifyLinearKey,
  postWorkspaceToBackend,
  deleteWorkspaceOnBackend,
  renameWorkspaceOnBackend,
} = require("../utils/linearWorkspaceElectron.js");

function broadcastLinearUpdated() {
  sendToCommandCenter("linear:workspaces-changed", {});
  sendToOverlay("linear:workspaces-changed", {});
}

/** @typedef {{ id?: string }} Rec */
/** @typedef {Rec & Record<string, any>} Stored */

/** @returns {Stored[]} */
function readWorkspacesArray(s = readState()) {
  const arr = s.linearWorkspaces;
  if (!Array.isArray(arr)) return [];
  return [...arr];
}

function publicShape(record) {
  const plain = decryptKeyMaterial(record.keyEnc);
  return {
    id: String(record.id || ""),
    label: String(record.label || ""),
    workspace_name: String(record.workspace_name || ""),
    workspace_url_key: String(record.workspace_url_key || ""),
    viewer_name: String(record.viewer_name || ""),
    viewer_email: String(record.viewer_email || ""),
    added_at: Number(record.added_at) || 0,
    key_preview:
      plain.length >= 4 ? `…${plain.slice(-4)}` : plain ? "…•••" : "",
  };
}

function dupIndex(entries, workspaceUrlKey) {
  if (!workspaceUrlKey) return -1;
  return entries.findIndex(
    (e) => String(e.workspace_url_key) === workspaceUrlKey,
  );
}

async function bootstrapSyncStoredWorkspacesToBackend() {
  try {
    const s = readState();
    let entries = readWorkspacesArray(s);
    if (!entries.length) return;

    let changed = false;
    for (let i = 0; i < entries.length; i++) {
      const plain = decryptKeyMaterial(entries[i].keyEnc);
      if (!plain) continue;
      const r = await postWorkspaceToBackend(
        plain,
        String(entries[i].label || ""),
      );
      if (!r.ok || !r.workspaceId) continue;
      if (r.workspaceId !== entries[i].id) {
        entries[i] = { ...entries[i], id: r.workspaceId };
        changed = true;
      }
    }
    if (changed) {
      writeState({ ...s, linearWorkspaces: entries });
      broadcastLinearUpdated();
    }
  } catch {
    /* never block startup */
  }
}

function scheduleBootstrapSyncToBackend() {
  const delayed = () => bootstrapSyncStoredWorkspacesToBackend();
  if (app.isReady()) setTimeout(delayed, 1500);
  else app.once("ready", () => setTimeout(delayed, 1500));
}

function register() {
  ipcMain.handle("linear:list", () => {
    const s = readState();
    const entries = readWorkspacesArray(s);
    return {
      workspaces: entries.map(publicShape),
      count: entries.length,
    };
  });

  ipcMain.handle("linear:add", async (_evt, { apiKey, label } = {}) => {
    const key = String(apiKey || "").trim();
    const lab = String(label || "").trim();
    if (!key) return { ok: false, error: "API key is empty" };

    let meta;
    try {
      meta = await verifyLinearKey(key);
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }

    const keyEncWrap = encryptKeyMaterial(key);
    if (!keyEncWrap) return { ok: false, error: "Could not store API key locally" };

    const s = readState();
    const entries = readWorkspacesArray(s);
    const dupAt = dupIndex(entries, meta.workspace_url_key);
    const now = Math.floor(Date.now());

    let record;

    const baseShared = {
      label: lab || (dupAt >= 0 ? String(entries[dupAt].label || "") : ""),
      workspace_name: meta.workspace_name || "",
      workspace_url_key: meta.workspace_url_key || "",
      viewer_name: meta.viewer_name || "",
      viewer_email: meta.viewer_email || "",
      keyEnc: keyEncWrap,
    };

    if (dupAt >= 0) {
      record = {
        ...entries[dupAt],
        ...baseShared,
        id: entries[dupAt].id,
        added_at: Number(entries[dupAt].added_at) || now,
      };
      entries[dupAt] = record;
    } else {
      record = {
        id: `lw_${crypto.randomBytes(6).toString("hex")}`,
        ...baseShared,
        added_at: now,
      };
      entries.push(record);
    }

    writeState({ ...s, linearWorkspaces: entries });

    try {
      const backend = await postWorkspaceToBackend(
        key,
        String(record.label || ""),
      );
      if (
        backend.ok &&
        backend.workspaceId &&
        backend.workspaceId !== record.id
      ) {
        const idx = entries.findIndex((x) => x.id === record.id);
        if (idx >= 0) {
          entries[idx] = { ...entries[idx], id: backend.workspaceId };
          writeState({
            ...readState(),
            linearWorkspaces: entries,
          });
          record = entries[idx];
        }
      }
    } catch {
      /* offline — Electron copy is still authoritative */
    }

    broadcastLinearUpdated();
    return { ok: true, workspace: publicShape(record) };
  });

  ipcMain.handle("linear:remove", async (_evt, { id } = {}) => {
    const targetId = String(id || "").trim();
    if (!targetId) return { ok: false, error: "missing id" };

    const s = readState();
    const entries = readWorkspacesArray(s);
    const before = entries.length;
    const kept = entries.filter((e) => String(e.id) !== targetId);
    if (kept.length === before) return { ok: false, error: "workspace not found" };

    writeState({ ...s, linearWorkspaces: kept });
    void deleteWorkspaceOnBackend(targetId).catch(() => {});
    broadcastLinearUpdated();
    return { ok: true };
  });

  ipcMain.handle("linear:rename", async (_evt, { id, label } = {}) => {
    const targetId = String(id || "").trim();
    const nextLabel = String(label || "").trim();
    if (!targetId) return { ok: false, error: "missing id" };

    const s = readState();
    const entries = readWorkspacesArray(s);
    const idx = entries.findIndex((e) => String(e.id) === targetId);
    if (idx < 0) return { ok: false, error: "workspace not found" };

    entries[idx] = {
      ...entries[idx],
      label: nextLabel,
    };

    writeState({ ...s, linearWorkspaces: entries });
    void renameWorkspaceOnBackend(targetId, nextLabel).catch(() => {});
    broadcastLinearUpdated();
    return { ok: true, workspace: publicShape(entries[idx]) };
  });

  scheduleBootstrapSyncToBackend();
}

module.exports = { register };
