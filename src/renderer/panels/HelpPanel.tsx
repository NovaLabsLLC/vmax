import React from "react";

export default function HelpPanel() {
  return (
    <div className="max-w-[640px] mx-auto px-6 pt-6 pb-10 space-y-6">
      <div>
        <div className="text-[18px] font-semibold tracking-tight">Help</div>
        <div className="text-[12.5px] text-white/50 mt-0.5">
          Keyboard shortcuts, permissions, and where things live.
        </div>
      </div>

      <Section title="Keyboard shortcuts">
        <Row k="⌘ Enter" desc="In the Task box: send to Plan." />
        <Row k="Esc" desc="Close the overlay sheet (when open)." />
        <Row k="⌘ ⇧ ␣" desc="(Reserved) push-to-talk — voice mode coming back." />
      </Section>

      <Section title="Permissions">
        <Row k="Accessibility" desc="Required to drive Cursor's chat. Grant in System Settings → Privacy → Accessibility, then quit and run again." />
        <Row k="Screen Recording" desc="Optional — only if you want vision-based features later." />
      </Section>

      <Section title="Where things live">
        <Row k="API keys" desc="Set OPENAI_API_KEY (and optionally ANTHROPIC_API_KEY) in the project's .env file." />
        <Row k="Recent repos" desc="Same file. Cleared by deleting it." />
        <Row k="Cursor handoff" desc="Tries `cursor` CLI → `open -a Cursor` → cursor:// URL → Finder." />
      </Section>

      <Section title="About">
        <Row k="Version" desc="0.1.0 (dev)" />
        <Row k="Models" desc="OpenAI gpt-4o-mini · Anthropic claude-sonnet-4-6 · OpenAI Whisper" />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="text-[10.5px] uppercase tracking-[0.14em] text-white/40 mb-2">{title}</div>
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] divide-y divide-white/[0.05]">
        {children}
      </div>
    </section>
  );
}

function Row({ k, desc }: { k: string; desc: string }) {
  return (
    <div className="px-3.5 py-2 flex items-center gap-3">
      <div className="text-[11px] mono text-emerald-300/85 min-w-[110px]">{k}</div>
      <div className="text-[12.5px] text-white/80 leading-snug">{desc}</div>
    </div>
  );
}
