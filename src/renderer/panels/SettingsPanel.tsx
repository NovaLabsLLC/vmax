import React, { useEffect, useState } from "react";

type Settings = {
  cursorAutoSend: boolean;
  defaultProvider: "auto" | "openai" | "claude";
  talkBack: boolean;
  openaiApiKey: string;
  anthropicApiKey: string;
};

const DEFAULT: Settings = {
  cursorAutoSend: true,
  defaultProvider: "auto",
  talkBack: true,
  openaiApiKey: "",
  anthropicApiKey: "",
};

export default function SettingsPanel() {
  const [s, setS] = useState<Settings>(DEFAULT);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const cur = (await window.exec.getSettings()) as any;
      setS({
        cursorAutoSend: cur.cursorAutoSend !== false,
        defaultProvider: cur.defaultProvider || "auto",
        talkBack: cur.talkBack !== false,
        openaiApiKey: cur.openaiApiKey || "",
        anthropicApiKey: cur.anthropicApiKey || "",
      });
    })();
  }, []);

  async function save() {
    await window.exec.saveSettings(s);
    setSaved(true);
    setTimeout(() => setSaved(false), 1400);
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
          hint="Used for Whisper (voice), TTS, and OpenAI text models."
          value={s.openaiApiKey}
          onChange={(v) => setS({ ...s, openaiApiKey: v })}
        />

        <KeyInput
          label="Anthropic API key"
          placeholder="sk-ant-…"
          hint="Used for Claude models when you pick Claude or Auto."
          value={s.anthropicApiKey}
          onChange={(v) => setS({ ...s, anthropicApiKey: v })}
        />

        <div className="text-[10.5px] text-white/35 leading-snug">
          Tip: the Claude Code CLI and Codex CLI use their own auth (run <code className="text-white/55">claude login</code> / <code className="text-white/55">codex login</code> in a terminal once). The keys above are only for in-app AI calls.
        </div>
      </div>

      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-5">
        <div>
          <Label text="Default provider" />
          <div className="flex gap-1.5">
            {(["auto", "openai", "claude"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setS({ ...s, defaultProvider: p })}
                className={`px-3 h-8 rounded-lg text-[12px] border transition-colors
                  ${s.defaultProvider === p
                    ? "bg-white text-black border-white"
                    : "bg-white/[0.04] border-white/[0.08] text-white/75 hover:bg-white/[0.07]"}`}
              >
                {p === "auto" ? "Auto" : p === "openai" ? "OpenAI" : "Claude"}
              </button>
            ))}
          </div>
          <div className="text-[10.5px] text-white/35 mt-1">
            Auto picks OpenAI if its key is set in .env, otherwise Claude.
          </div>
        </div>

        <Toggle
          label="Automate scans & Cursor handoff"
          sub="When Ask proposes a repo scan or send-to-Cursor action, Exec runs it without waiting for a second “yes”. Opens Cursor via CLI or macOS open, then ⌘I → paste (clipboard fallback if automation fails). Requires Accessibility for Electron."
          value={s.cursorAutoSend}
          onChange={(v) => setS({ ...s, cursorAutoSend: v })}
        />

        <Toggle
          label="Talk Back (spoken summaries)"
          sub="After Plan, Ask, diff summary, diagnosis, or OpenClaw, Exec reads a short line aloud using the system voice. Toggle from Settings or the floating bar. Does not block the UI."
          value={s.talkBack}
          onChange={(v) => setS({ ...s, talkBack: v })}
        />

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={save}
            className="h-9 px-4 rounded-lg text-[12.5px] font-medium bg-white text-black hover:bg-white/90"
          >
            Save settings
          </button>
          {saved && <span className="text-[11.5px] text-emerald-300">Saved.</span>}
        </div>
      </div>
    </div>
  );
}

function Label({ text, sub }: { text: string; sub?: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-1">
      <div className="text-[10.5px] uppercase tracking-[0.14em] text-white/40">{text}</div>
      {sub && <div className="text-[10.5px] text-white/30">{sub}</div>}
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

function Toggle({
  label, sub, value, onChange,
}: { label: string; sub?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="w-full flex items-center gap-3 text-left"
    >
      <div className={`w-9 h-5 rounded-full transition-colors flex items-center px-0.5
        ${value ? "bg-emerald-500/80" : "bg-white/15"}`}>
        <div className={`w-4 h-4 rounded-full bg-white transition-transform
          ${value ? "translate-x-4" : "translate-x-0"}`} />
      </div>
      <div className="min-w-0">
        <div className="text-[12.5px] text-white">{label}</div>
        {sub && <div className="text-[10.5px] text-white/40 leading-snug">{sub}</div>}
      </div>
    </button>
  );
}
