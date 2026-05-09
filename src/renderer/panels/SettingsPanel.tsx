import React, { useEffect, useState } from "react";

type Settings = {
  openaiApiKey: string;
  anthropicApiKey: string;
};

type CliInfo = { installed: boolean; version?: string; authed?: boolean; authVia?: "env" | "file" };
type CliStatus = { claude: CliInfo; codex: CliInfo };

const DEFAULT: Settings = {
  openaiApiKey: "",
  anthropicApiKey: "",
};

export default function SettingsPanel() {
  const [s, setS] = useState<Settings>(DEFAULT);
  const [saved, setSaved] = useState(false);
  const [cli, setCli] = useState<CliStatus | null>(null);
  const [busy, setBusy] = useState<{ tool: "claude" | "codex"; kind: "login" | "install" } | null>(null);

  useEffect(() => {
    (async () => {
      const cur = (await window.exec.getSettings()) as any;
      setS({
        openaiApiKey: cur.openaiApiKey || "",
        anthropicApiKey: cur.anthropicApiKey || "",
      });
    })();
    void refreshCli();
  }, []);

  async function refreshCli() {
    try {
      const r = await window.exec.cliStatus();
      setCli(r);
    } catch {
      /* noop */
    }
  }

  async function save() {
    await window.exec.saveSettings(s);
    setSaved(true);
    setTimeout(() => setSaved(false), 1400);
  }

  async function runLogin(tool: "claude" | "codex") {
    setBusy({ tool, kind: "login" });
    try {
      await window.exec.cliOpenLogin(tool);
      // Re-check once Terminal has had a moment to do its thing.
      setTimeout(() => void refreshCli(), 4000);
    } finally {
      setBusy(null);
    }
  }

  async function runInstall(tool: "claude" | "codex") {
    setBusy({ tool, kind: "install" });
    try {
      await window.exec.cliOpenInstall(tool);
      setTimeout(() => void refreshCli(), 8000);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-[640px] mx-auto px-6 pt-6 pb-10 space-y-6">
      <div>
        <div className="text-[18px] font-semibold tracking-tight">Settings</div>
        <div className="text-[12.5px] text-white/50 mt-0.5">
          Drop your keys in here. Stored locally in your Exec user data, never sent anywhere except the model provider.
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
      </div>
    </div>
  );
}

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
