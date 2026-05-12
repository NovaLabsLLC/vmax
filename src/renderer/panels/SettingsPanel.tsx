import React, { useEffect, useRef, useState } from "react";
import {
  addLinearWorkspace,
  listLinearWorkspaces,
  removeLinearWorkspace,
  renameLinearWorkspace,
  type LinearWorkspace,
} from "../utils/linearWorkspacesApi";

type Settings = {
  openaiApiKey: string;
  anthropicApiKey: string;
};

/*
type CliInfo = { installed: boolean; version?: string; authed?: boolean; authVia?: "env" | "file" };
type CliStatus = { claude: CliInfo; codex: CliInfo };
*/

const DEFAULT: Settings = {
  openaiApiKey: "",
  anthropicApiKey: "",
};

export default function SettingsPanel() {
  const [s, setS] = useState<Settings>(DEFAULT);
  const [saved, setSaved] = useState(false);
  /* TEMP — Coding agent CLIs card hidden
  const [cli, setCli] = useState<CliStatus | null>(null);
  const [busy, setBusy] = useState<{ tool: "claude" | "codex"; kind: "login" | "install" } | null>(null);
  */
  // Linear: stored in Electron userData + mirrored to FastAPI when the server runs.
  const [linearWorkspaces, setLinearWorkspaces] = useState<LinearWorkspace[]>([]);
  const [linearLoading, setLinearLoading] = useState(false);
  const [linearListError, setLinearListError] = useState<string | null>(null);
  const [newLinearKey, setNewLinearKey] = useState("");
  const [newLinearLabel, setNewLinearLabel] = useState("");
  const [addingLinear, setAddingLinear] = useState(false);
  const [addLinearError, setAddLinearError] = useState<string | null>(null);

  async function refreshLinearWorkspaces() {
    setLinearLoading(true);
    setLinearListError(null);
    try {
      const list = await listLinearWorkspaces();
      setLinearWorkspaces(list);
    } catch (err) {
      setLinearListError(String((err as Error)?.message || err));
    } finally {
      setLinearLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      const cur = await window.exec.getSettings();
      setS({
        openaiApiKey: cur.openaiApiKey || "",
        anthropicApiKey: cur.anthropicApiKey || "",
      });
    })();
    // void refreshCli();
    void refreshLinearWorkspaces();
    const offLinear = window.exec.onLinearWorkspacesChanged(() => {
      void refreshLinearWorkspaces();
    });
    return () => offLinear();
  }, []);

  /*
  async function refreshCli() {
    try {
      const r = await window.exec.cliStatus();
      setCli(r);
    } catch {
    }
  }
  */

  async function save() {
    await window.exec.saveSettings(s);
    setSaved(true);
    setTimeout(() => setSaved(false), 1400);
  }

  async function addWorkspace() {
    const key = newLinearKey.trim();
    if (!key) return;
    setAddingLinear(true);
    setAddLinearError(null);
    try {
      await addLinearWorkspace({ apiKey: key, label: newLinearLabel.trim() });
      setNewLinearKey("");
      setNewLinearLabel("");
      await refreshLinearWorkspaces();
    } catch (err) {
      setAddLinearError(String((err as Error)?.message || err));
    } finally {
      setAddingLinear(false);
    }
  }

  async function removeWorkspace(id: string) {
    try {
      await removeLinearWorkspace(id);
      await refreshLinearWorkspaces();
    } catch (err) {
      setLinearListError(String((err as Error)?.message || err));
    }
  }

  async function renameWorkspace(id: string, label: string) {
    try {
      await renameLinearWorkspace(id, label);
      await refreshLinearWorkspaces();
    } catch (err) {
      setLinearListError(String((err as Error)?.message || err));
    }
  }

  return (
    <div className="w-full max-w-none box-border px-4 sm:px-6 lg:px-8 pt-6 pb-10 space-y-6">
      <div>
        <div className="text-[18px] font-semibold tracking-tight">Settings</div>
        <div className="text-[12.5px] text-white/50 mt-0.5">
          AI keys live in your Vmax user data (OpenAI / Anthropic). Linear API keys persist in app data locally (encrypted where macOS supports it) and are copied to your FastAPI process when it’s running — you only ever see an ID and a trailing “…abcd” preview here.
        </div>
      </div>

      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-5">
        <div className="text-[10.5px] uppercase tracking-[0.14em] text-white/40">API keys</div>

        <KeyInput
          label="OpenAI API key"
          placeholder="sk-…"
          hint="Used for Whisper (voice transcription) and OpenAI text models."
          value={s.openaiApiKey}
          onChange={(v) => setS({ ...s, openaiApiKey: v })}
        />

        <KeyInput
          label="Anthropic API key"
          placeholder="sk-ant-…"
          hint="Used for Claude in-app calls."
          value={s.anthropicApiKey}
          onChange={(v) => setS({ ...s, anthropicApiKey: v })}
        />

        <LinearWorkspaceList
          workspaces={linearWorkspaces}
          loading={linearLoading}
          listError={linearListError}
          newKey={newLinearKey}
          onNewKeyChange={setNewLinearKey}
          newLabel={newLinearLabel}
          onNewLabelChange={setNewLinearLabel}
          adding={addingLinear}
          addError={addLinearError}
          onAdd={() => void addWorkspace()}
          onRemove={(id) => void removeWorkspace(id)}
          onRename={(id, label) => void renameWorkspace(id, label)}
          onRefresh={() => void refreshLinearWorkspaces()}
          onOpenLinearApi={() => void window.exec.openUrl("https://linear.app/settings/api")}
        />

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={save}
            className="h-9 px-4 rounded-lg text-[12.5px] font-medium bg-white text-black hover:bg-white/90"
          >
            Save
          </button>
          {saved && <span className="text-[11.5px] text-emerald-300">Saved.</span>}
        </div>
      </div>

      {/* TEMP — Coding agent CLIs + View Agents shortcut (restore with state + CliRow below)
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-[10.5px] uppercase tracking-[0.14em] text-white/40">Coding agent CLIs</div>
          <button
            type="button"
            onClick={() => void refreshCli()}
            className="text-[10.5px] text-white/45 hover:text-white/80"
          >
            re-check
          </button>
        </div>

        <CliRow
          name="Claude Code CLI"
          info={cli?.claude}
          busy={busy?.tool === "claude" ? busy.kind : null}
          onLogin={() => void runLogin("claude")}
          onInstall={() => void runInstall("claude")}
        />

        <CliRow
          name="Codex CLI"
          info={cli?.codex}
          busy={busy?.tool === "codex" ? busy.kind : null}
          onLogin={() => void runLogin("codex")}
          onInstall={() => void runInstall("codex")}
        />

        <div className="text-[10.5px] text-white/35 leading-snug">
          Hitting <span className="text-white/55">Log in</span> opens a Terminal window with the auth command pre-typed. Finish the OAuth flow there, then come back and hit <span className="text-white/55">re-check</span>.
        </div>

        <div className="pt-4 mt-1 border-t border-white/[0.06]">
          <button
            type="button"
            onClick={() => void window.exec.focusCommandCenter({ view: "workspace" })}
            className="h-9 px-3 rounded-lg text-[11.5px] font-medium bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.10] text-white/85"
          >
            View Agents graph →
          </button>
          <div className="text-[10px] text-white/30 mt-1.5">See which CLIs are wired to Vmax as connected nodes.</div>
        </div>
      </div>
      */}
    </div>
  );
}

/*
function CliRow({
  name,
  info,
  busy,
  onLogin,
  onInstall,
}: {
  name: string;
  info?: CliInfo;
  busy: "login" | "install" | null;
  onLogin: () => void;
  onInstall: () => void;
}) {
  const installed = info?.installed === true;
  const authed = info?.authed === true;
  const checking = info === undefined;

  let dotCls = "bg-white/30";
  let subtitle = "checking…";
  if (!checking) {
    if (!installed) { dotCls = "bg-rose-400"; subtitle = "not found on PATH"; }
    else if (!authed) { dotCls = "bg-amber-400"; subtitle = `${info?.version || "installed"} · not signed in`; }
    else {
      dotCls = "bg-emerald-400";
      const via = info?.authVia === "env" ? "via env var" : "signed in";
      subtitle = `${info?.version || "installed"} · ${via}`;
    }
  }

  return (
    <div className="flex items-center gap-3">
      <span className={`w-2 h-2 rounded-full shrink-0 ${dotCls}`} />
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] text-white">{name}</div>
        <div className="text-[10.5px] text-white/45 truncate">{subtitle}</div>
      </div>
      {!installed ? (
        <button
          type="button"
          onClick={onInstall}
          disabled={busy === "install"}
          className="h-8 px-3 rounded-lg text-[11.5px] font-medium bg-white text-black hover:bg-white/90 disabled:opacity-50"
        >
          {busy === "install" ? "Opening…" : "Install"}
        </button>
      ) : !authed ? (
        <button
          type="button"
          onClick={onLogin}
          disabled={busy === "login"}
          className="h-8 px-3 rounded-lg text-[11.5px] font-medium bg-white text-black hover:bg-white/90 disabled:opacity-50"
        >
          {busy === "login" ? "Opening…" : "Log in"}
        </button>
      ) : (
        <button
          type="button"
          onClick={onLogin}
          disabled={busy === "login"}
          className="h-8 px-3 rounded-lg text-[11.5px] font-medium bg-white/[0.10] hover:bg-white/[0.16] border border-white/[0.18] text-white/85 disabled:opacity-50"
          title="Open a Terminal to re-auth (only if you're hitting auth errors)"
        >
          {busy === "login" ? "Opening…" : "Re-auth"}
        </button>
      )}
    </div>
  );
}
*/

function KeyInput({
  label,
  placeholder,
  hint,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [reveal, setReveal] = useState(false);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <div className="text-[12px] text-white/85">{label}</div>
        <button
          type="button"
          onClick={() => setReveal((x) => !x)}
          className="text-[10.5px] text-white/45 hover:text-white/80"
        >
          {reveal ? "hide" : "show"}
        </button>
      </div>
      <input
        type={reveal ? "text" : "password"}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoComplete="off"
        className="w-full h-9 px-3 rounded-lg bg-black/40 border border-white/[0.10] text-[12.5px] text-white placeholder:text-white/30 focus:outline-none focus:border-white/30 font-mono"
      />
      {hint && <div className="text-[10.5px] text-white/35 mt-1 leading-snug">{hint}</div>}
    </div>
  );
}

function LinearWorkspaceList({
  workspaces,
  loading,
  listError,
  newKey,
  onNewKeyChange,
  newLabel,
  onNewLabelChange,
  adding,
  addError,
  onAdd,
  onRemove,
  onRename,
  onRefresh,
  onOpenLinearApi,
}: {
  workspaces: LinearWorkspace[];
  loading: boolean;
  listError: string | null;
  newKey: string;
  onNewKeyChange: (v: string) => void;
  newLabel: string;
  onNewLabelChange: (v: string) => void;
  adding: boolean;
  addError: string | null;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onRename: (id: string, label: string) => void;
  onRefresh: () => void;
  onOpenLinearApi: () => void;
}) {
  const [showAddForm, setShowAddForm] = useState(false);
  const wasAddingRef = useRef(false);

  useEffect(() => {
    if (wasAddingRef.current && !adding && !addError) {
      setShowAddForm(false);
    }
    wasAddingRef.current = adding;
  }, [adding, addError]);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[12px] text-white/85">Linear workspaces</div>
        <div className="flex items-center gap-3 flex-wrap justify-end">
          <button
            type="button"
            onClick={() => setShowAddForm((o) => !o)}
            className="text-[10.5px] font-medium px-2.5 h-7 rounded-md bg-white text-black hover:bg-white/90 border border-white"
          >
            {showAddForm ? "Hide" : "+ Add workspace"}
          </button>
          <button
            type="button"
            onClick={onRefresh}
            className="text-[10.5px] text-white/45 hover:text-white/80"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={onOpenLinearApi}
            className="text-[10.5px] text-white/45 hover:text-white/80"
          >
            Open Linear API keys
          </button>
        </div>
      </div>

      {listError ? (
        <div className="text-[11.5px] text-rose-300/90 leading-snug">
          Couldn’t load workspaces: {listError}
        </div>
      ) : workspaces.length === 0 ? (
        <div className="text-[11.5px] text-white/45 leading-snug">
          No workspaces connected. Tap{" "}
          <span className="text-white/70 font-medium">+ Add workspace</span> and paste a Linear personal API key
          — Vmax checks it against Linear&apos;s GraphQL API, saves it locally, and syncs it to your backend when
          reachable.
        </div>
      ) : (
        <ul className="space-y-2">
          {workspaces.map((w) => (
            <LinearWorkspaceRow
              key={w.id}
              entry={w}
              onRemove={() => onRemove(w.id)}
              onRename={(label) => onRename(w.id, label)}
            />
          ))}
        </ul>
      )}

      {showAddForm ? (
        <div className="rounded-xl border border-white/[0.08] bg-black/30 p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="text-[10.5px] uppercase tracking-[0.14em] text-white/40">
              Add workspace
            </div>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="text-[10px] text-white/45 hover:text-white/80 shrink-0"
            >
              Close
            </button>
          </div>
          <input
            type="password"
            value={newKey}
            placeholder="lin_api_…"
            onChange={(e) => onNewKeyChange(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            className="w-full h-9 px-3 rounded-lg bg-black/40 border border-white/[0.10] text-[12.5px] text-white placeholder:text-white/30 focus:outline-none focus:border-white/30 font-mono"
          />
          <input
            type="text"
            value={newLabel}
            placeholder="Label (optional — defaults to the workspace name)"
            onChange={(e) => onNewLabelChange(e.target.value)}
            spellCheck={false}
            className="w-full h-9 px-3 rounded-lg bg-black/40 border border-white/[0.10] text-[12.5px] text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={adding || !newKey.trim()}
              onClick={onAdd}
              className="h-8 px-3 rounded-lg text-[11.5px] font-medium bg-white text-black hover:bg-white/90 disabled:opacity-45"
            >
              {adding ? "Verifying…" : "Connect workspace"}
            </button>
            {addError ? (
              <span className="text-[11.5px] text-rose-300/90 leading-snug">{addError}</span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LinearWorkspaceRow({
  entry,
  onRemove,
  onRename,
}: {
  entry: LinearWorkspace;
  onRemove: () => void;
  onRename: (label: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.label || "");

  const displayName = entry.label || entry.workspace_name || "Linear workspace";
  const sub = [
    entry.viewer_name,
    entry.viewer_email,
    entry.workspace_name && entry.label ? entry.workspace_name : "",
    entry.key_preview,
  ]
    .filter(Boolean)
    .join(" · ");

  function commitRename() {
    const next = draft.trim();
    setEditing(false);
    if (next !== (entry.label || "")) onRename(next);
  }

  return (
    <li className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2">
      <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              else if (e.key === "Escape") {
                setDraft(entry.label || "");
                setEditing(false);
              }
            }}
            className="w-full h-7 px-2 rounded-md bg-black/40 border border-white/[0.14] text-[12.5px] text-white focus:outline-none focus:border-white/30"
          />
        ) : (
          <button
            type="button"
            className="text-left text-[12.5px] text-white truncate hover:text-white/80"
            title="Rename"
            onClick={() => {
              setDraft(entry.label || "");
              setEditing(true);
            }}
          >
            {displayName}
          </button>
        )}
        <div className="text-[10.5px] text-white/45 truncate">{sub || "verified"}</div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 h-7 px-2.5 rounded-md text-[11px] text-rose-200/90 hover:text-rose-100 bg-rose-500/[0.08] hover:bg-rose-500/[0.14] border border-rose-400/20"
      >
        Remove
      </button>
    </li>
  );
}
