import React, { useEffect, useState } from "react";

type Profile = { name?: string; email?: string; role?: string };

export default function ProfilePanel({ onSaved }: { onSaved?: (p: Profile) => void }) {
  const [profile, setProfile] = useState<Profile>({});
  const [saved, setSaved] = useState(false);
  const [linearOn, setLinearOn] = useState(false);

  useEffect(() => {
    (async () => setProfile((await window.exec.getProfile()) || {}))();
  }, []);

  useEffect(() => {
    (async () => {
      const g = await window.exec.getSettings();
      setLinearOn(!!g.linearApiKey?.trim());
    })();
    const off = window.exec.onSettingsUpdated((sett) => {
      if (typeof sett.linearApiKey === "string") setLinearOn(!!sett.linearApiKey.trim());
    });
    return () => off();
  }, []);

  async function save() {
    const p = await window.exec.saveProfile(profile);
    setProfile(p);
    setSaved(true);
    onSaved?.(p);
    setTimeout(() => setSaved(false), 1400);
  }

  return (
    <div className="max-w-[640px] mx-auto px-6 pt-6 pb-10 space-y-6">
      <div>
        <div className="text-[18px] font-semibold tracking-tight">Profile</div>
        <div className="text-[12.5px] text-white/50 mt-0.5">
          Used for greetings, talk-back tone, and (later) shared workspaces.
        </div>
      </div>

      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-4">
        <div className="flex items-center gap-3">
          <Avatar name={profile.name} />
          <div className="min-w-0">
            <div className="text-[14px] font-medium truncate">{profile.name || "(no name)"}</div>
            <div className="text-[12px] text-white/50 truncate">{profile.role || "(no role)"}</div>
          </div>
        </div>

        <Field label="Name">
          <Input value={profile.name || ""} onChange={(v) => setProfile((p) => ({ ...p, name: v }))} placeholder="Onkar Gore" />
        </Field>
        <Field label="Email" sub="optional">
          <Input value={profile.email || ""} onChange={(v) => setProfile((p) => ({ ...p, email: v }))} placeholder="you@example.com" />
        </Field>
        <Field label="Role" sub="optional — shapes future suggestions">
          <Input value={profile.role || ""} onChange={(v) => setProfile((p) => ({ ...p, role: v }))} placeholder="Founder, Senior Engineer, …" />
        </Field>

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

      <Section title="Connected services" hint="Linear is wired from Settings → API keys.">
        <ServiceRow name="Linear" status={linearOn ? "Personal API key saved" : "not connected"} connected={linearOn} />
        <ServiceRow name="GitHub" status="not connected" connected={false} />
        <ServiceRow name="Cursor" status="auto-detected via macOS" connected />
      </Section>
    </div>
  );
}

function Avatar({ name }: { name?: string }) {
  const initials = (name || "?").split(/\s+/).slice(0, 2).map((s) => s[0] || "").join("").toUpperCase();
  return (
    <div className="w-12 h-12 rounded-full bg-white text-black flex items-center justify-center text-[14px] font-bold">
      {initials || "?"}
    </div>
  );
}

function Field({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1">
        <div className="text-[10.5px] uppercase tracking-[0.14em] text-white/40">{label}</div>
        {sub && <div className="text-[10.5px] text-white/30">{sub}</div>}
      </div>
      {children}
    </div>
  );
}

function Input({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg
                 px-3 py-2 text-[13px] text-white placeholder-white/30
                 outline-none focus:border-white/25"
    />
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline gap-2 mb-2">
        <div className="text-[10.5px] uppercase tracking-[0.14em] text-white/40">{title}</div>
        {hint && <div className="text-[10.5px] text-white/30">{hint}</div>}
      </div>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function ServiceRow({ name, status, connected = false }: { name: string; status: string; connected?: boolean }) {
  const dot = connected ? "bg-emerald-400" : "bg-white/30";
  return (
    <div className="rounded-lg bg-white/[0.02] border border-white/[0.05] px-3 py-2 flex items-center gap-3">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
      <span className="text-[12.5px] text-white/85">{name}</span>
      <span className="ml-auto text-[10.5px] text-white/40">{status}</span>
    </div>
  );
}
