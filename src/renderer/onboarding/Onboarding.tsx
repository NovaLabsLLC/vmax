import React, { useState } from "react";

type Step = 0 | 1 | 2;

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>(0);
  const [profile, setProfile] = useState<{ name: string; role: string }>({ name: "", role: "" });
  const [busy, setBusy] = useState(false);

  async function finish() {
    setBusy(true);
    try {
      if (profile.name || profile.role) await window.exec.saveProfile(profile);
      await window.exec.finishOnboarding();
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="absolute inset-0 z-50 bg-[#08080a] flex flex-col">
      {/* draggable title region (traffic lights) */}
      <div className="drag h-11 shrink-0" />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[520px] mx-auto px-6 py-8">
          <Steps current={step} />

          {step === 0 && (
            <Card>
              <Hero />
              <p className="text-[13px] text-white/70 leading-relaxed mt-4">
                Vmax is a control layer for coding agents. It plans, runs checks,
                explains failures, and tells Cursor exactly what to do next.
              </p>
              <p className="text-[12.5px] text-white/45 leading-relaxed mt-2">
                We'll set up a profile and a couple of permissions. Takes ~30 seconds.
              </p>
              <Footer
                left={<span className="text-[11px] text-white/35">Step 1 of 3</span>}
                right={<Primary onClick={() => setStep(1)}>Get started</Primary>}
              />
            </Card>
          )}

          {step === 1 && (
            <Card>
              <Heading title="Who are you?" sub="Used for greetings and (later) shared workspaces. All fields optional." />
              <div className="space-y-3 mt-4">
                <Field label="Name">
                  <Input value={profile.name} onChange={(v) => setProfile((p) => ({ ...p, name: v }))} placeholder="Onkar Gore" />
                </Field>
                <Field label="Role">
                  <Input value={profile.role} onChange={(v) => setProfile((p) => ({ ...p, role: v }))} placeholder="Founder, Senior Engineer, …" />
                </Field>
              </div>
              <Footer
                left={<Secondary onClick={() => setStep(0)}>Back</Secondary>}
                right={<Primary onClick={() => setStep(2)}>Next</Primary>}
              />
            </Card>
          )}

          {step === 2 && (
            <Card>
              <Heading title="Permissions" sub="Optional now — you can grant later in System Settings." />
              <ul className="mt-4 space-y-2">
                <Bullet>
                  <strong className="text-white/85">Accessibility</strong>
                  <div className="text-white/55">
                    Lets Vmax drive Cursor's chat (open Composer, paste, send). macOS will prompt the first time
                    you click <em>Send to Cursor</em>.
                  </div>
                </Bullet>
                <Bullet>
                  <strong className="text-white/85">Screen Recording</strong>
                  <div className="text-white/55">Only needed if you turn on vision features later.</div>
                </Bullet>
              </ul>
              <Footer
                left={<Secondary onClick={() => setStep(1)}>Back</Secondary>}
                right={<Primary onClick={() => void finish()} disabled={busy}>{busy ? "Finishing…" : "Finish"}</Primary>}
              />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- pieces ----

function Hero() {
  return (
    <div>
      <div className="text-[20px] font-semibold tracking-tight">Welcome to Vmax</div>
      <div className="text-[12.5px] text-white/45 mt-1">control layer for coding agents</div>
    </div>
  );
}

function Steps({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-1.5 mb-5">
      {[0, 1, 2].map((i) => (
        <div key={i} className={`h-1 flex-1 rounded-full ${i <= current ? "bg-white" : "bg-white/10"}`} />
      ))}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">{children}</div>
  );
}

function Heading({ title, sub }: { title: string; sub?: string }) {
  return (
    <div>
      <div className="text-[17px] font-semibold tracking-tight">{title}</div>
      {sub && <div className="text-[12px] text-white/50 leading-relaxed mt-1">{sub}</div>}
    </div>
  );
}

function Footer({ left, right }: { left?: React.ReactNode; right?: React.ReactNode }) {
  return <div className="flex items-center justify-between mt-6">{left || <span />}{right}</div>;
}

function Primary({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`h-9 px-4 rounded-lg text-[12.5px] font-medium tracking-tight bg-white text-black hover:bg-white/90 ${disabled ? "opacity-60 cursor-wait" : ""}`}
    >
      {children}
    </button>
  );
}
function Secondary({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`h-9 px-3 rounded-lg text-[12.5px] text-white/75 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] ${disabled ? "opacity-60" : ""}`}
    >
      {children}
    </button>
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
function Input({ value, onChange, placeholder, type }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <input
      type={type || "text"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-[13px] text-white placeholder-white/30 outline-none focus:border-white/25"
    />
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="rounded-lg bg-white/[0.025] border border-white/[0.05] p-3 text-[12.5px] leading-relaxed">
      {children}
    </li>
  );
}
