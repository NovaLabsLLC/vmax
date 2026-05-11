// Electron main-process helpers: verify a Linear API key via GraphQL, encrypt
// keys at rest (safeStorage when available), and push workspaces to FastAPI.

"use strict";

const { Buffer } = require("buffer");
const { safeStorage } = require("electron");

const LINEAR_GRAPHQL = "https://api.linear.app/graphql";

const VERIFY_QUERY = `
  query VerifyLinearViewer {
    viewer {
      id
      name
      displayName
      email
      organization { name urlKey }
    }
  }
`;

function vmaxBackendUrl() {
  const raw = (
    process.env.VMAX_BACKEND_URL || "http://127.0.0.1:8000"
  ).trim();
  return raw.replace(/\/+$/, "");
}

/** Encrypt Linear API keys for persisted JSON. Fallback to plaintext envelope
 * when safeStorage is unavailable (unlikely on macOS). */
function encryptKeyMaterial(plaintext) {
  const t = String(plaintext || "").trim();
  if (!t) return null;
  if (safeStorage.isEncryptionAvailable()) {
    const buf = safeStorage.encryptString(t);
    return { scheme: "ss", blob: Buffer.from(buf).toString("base64") };
  }
  return { scheme: "plain", value: t };
}

function decryptKeyMaterial(stored) {
  if (!stored || typeof stored !== "object") return "";
  const scheme = stored.scheme || stored.v;
  if (scheme === "plain") return String(stored.value || "");
  if (scheme === "ss" && stored.blob) {
    try {
      const raw = Buffer.from(String(stored.blob), "base64");
      return safeStorage.decryptString(raw);
    } catch {
      return "";
    }
  }
  return "";
}

async function linearGraphQl(apiKey, query, variables) {
  const res = await fetch(LINEAR_GRAPHQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: String(apiKey).trim(),
    },
    body: JSON.stringify({
      query,
      ...(variables ? { variables } : {}),
    }),
  });

  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Linear response was not JSON (HTTP ${res.status})`);
  }
  if (json.errors?.length) {
    const msg = json.errors.map((e) => e.message).filter(Boolean).join("; ");
    throw new Error(msg || "Linear GraphQL error");
  }
  if (!res.ok) throw new Error(`Linear HTTP ${res.status}`);
  return json.data || {};
}

/**
 * Validates `apiKey` and returns viewer/workspace metadata mirroring FastAPI's
 * `verify_linear_key` shape.
 */
async function verifyLinearKey(apiKey) {
  const data = await linearGraphQl(apiKey, VERIFY_QUERY);
  const viewer = data.viewer || {};
  const org = viewer.organization || {};
  return {
    viewer_name: viewer.name || viewer.displayName || "",
    viewer_email: viewer.email || "",
    workspace_name: org.name || "",
    workspace_url_key: org.urlKey || "",
  };
}

async function postWorkspaceToBackend(apiKey, label) {
  const base = vmaxBackendUrl();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`${base}/v1/linear/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        api_key: String(apiKey || "").trim(),
        label: String(label || "").trim(),
      }),
      signal: controller.signal,
    });

    let body = null;
    try {
      body = await res.json();
    } catch {
      /* noop */
    }
    if (!res.ok) {
      const detail =
        (body &&
          (typeof body.detail === "string"
            ? body.detail
            : JSON.stringify(body.detail || body))) || res.statusText;
      return {
        ok: false,
        error: `${res.status} ${detail}`,
        workspaceId: "",
      };
    }

    const w = body && body.workspace;
    const workspaceId = w?.id ? String(w.id) : "";
    const keyPreview =
      typeof w?.key_preview === "string" ? w.key_preview : "";

    return { ok: true, workspaceId, keyPreview, workspace: w };
  } catch (err) {
    const msg = String((err && err.message) || err);
    const short = msg.includes("aborted") ? "timeout" : msg;
    return { ok: false, error: short, workspaceId: "" };
  } finally {
    clearTimeout(t);
  }
}

async function deleteWorkspaceOnBackend(workspaceId) {
  const base = vmaxBackendUrl();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(
      `${base}/v1/linear/workspaces/${encodeURIComponent(workspaceId)}`,
      { method: "DELETE", Accept: "application/json", signal: controller.signal },
    );
    /* 404 is fine — stale id */
    await res.arrayBuffer().catch(() => {});
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function renameWorkspaceOnBackend(workspaceId, label) {
  const base = vmaxBackendUrl();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(
      `${base}/v1/linear/workspaces/${encodeURIComponent(workspaceId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ label: String(label || "").trim() }),
        signal: controller.signal,
      },
    );
    await res.arrayBuffer().catch(() => {});
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

module.exports = {
  vmaxBackendUrl,
  encryptKeyMaterial,
  decryptKeyMaterial,
  verifyLinearKey,
  postWorkspaceToBackend,
  deleteWorkspaceOnBackend,
  renameWorkspaceOnBackend,
};
