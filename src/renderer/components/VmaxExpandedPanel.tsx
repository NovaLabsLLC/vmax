import React from "react";
import type { VmaxPanelPayload } from "../types";

export type VmaxExpandedPanelProps = {
  question: string;
  panel: VmaxPanelPayload;
  parseWarning?: boolean;
  actionsDisabled?: boolean;
  onCollapse: () => void;
  onCopyCursor: () => void;
  onSendClaude: () => void;
  onOpenClaw: () => void;
  onRunSafeCommand: (command: string) => void;
};

export default function VmaxExpandedPanel({
  question,
  panel,
  parseWarning,
  actionsDisabled,
  onCollapse,
  onCopyCursor,
  onSendClaude,
  onOpenClaw,
  onRunSafeCommand,
}: VmaxExpandedPanelProps) {
  const safeCmd = panel.suggestedCommands?.[0]?.trim() || "";
  const hasCursor = !!panel.cursorPrompt?.trim();
  const hasClaude = !!panel.claudePrompt?.trim();

  return (
    <div
      className="no-drag flex flex-col h-full min-h-0 rounded-[16px] overflow-hidden
                 border border-white/[0.12] bg-black/[0.22] backdrop-blur-xl
                 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_24px_48px_-16px_rgba(0,0,0,0.65)]"
    >
      <div className="shrink-0 px-3.5 py-2.5 flex items-start justify-between gap-2 border-b border-white/[0.08]
                      bg-gradient-to-r from-emerald-500/[0.08] via-transparent to-violet-500/[0.06]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.16em] text-emerald-200/70 font-semibold">Vmax</span>
            {parseWarning ? (
              <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-100/90 border border-amber-400/25">
                Fallback
              </span>
            ) : null}
          </div>
          <p className="text-[11px] text-white/45 mt-0.5 truncate" title={question}>
            {question}
          </p>
        </div>
        <button
          type="button"
          onClick={onCollapse}
          title="Collapse"
          className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-white/55 hover:text-white
                     hover:bg-white/[0.08] border border-transparent hover:border-white/10 transition-all"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3.5 py-3 space-y-3">
        <Section title="Summary" accent="emerald">
          <p className="text-[13px] text-white/[0.92] leading-relaxed">{panel.summary || "—"}</p>
        </Section>

        <Section title="What Vmax sees" accent="sky">
          <p className="text-[12.5px] text-white/78 leading-relaxed whitespace-pre-wrap">
            {panel.whatVmaxSees?.trim() || "—"}
          </p>
        </Section>

        <Section title="Likely problem" accent="amber">
          <p className="text-[12.5px] text-amber-100/85 leading-relaxed">
            {panel.likelyProblem?.trim() || "—"}
          </p>
        </Section>

        <Section title="Next steps" accent="violet">
          {panel.nextSteps?.length ? (
            <ol className="list-decimal list-inside space-y-1.5 text-[12.5px] text-white/80">
              {panel.nextSteps.map((s, i) => (
                <li key={i} className="leading-snug pl-0.5">{s}</li>
              ))}
            </ol>
          ) : (
            <p className="text-[12px] text-white/45">—</p>
          )}
        </Section>

        <Section title="Cursor prompt" accent="white">
          {hasCursor ? (
            <pre className="mono text-[11.5px] text-white/88 whitespace-pre-wrap leading-relaxed p-2.5 rounded-xl
                           bg-black/35 border border-white/[0.06] max-h-[120px] overflow-y-auto">
              {panel.cursorPrompt}
            </pre>
          ) : (
            <p className="text-[12px] text-white/45">—</p>
          )}
        </Section>

        <Section title="Claude Code prompt" accent="amber">
          {hasClaude ? (
            <pre className="mono text-[11.5px] text-amber-50/90 whitespace-pre-wrap leading-relaxed p-2.5 rounded-xl
                           bg-amber-950/25 border border-amber-400/15 max-h-[120px] overflow-y-auto">
              {panel.claudePrompt}
            </pre>
          ) : (
            <p className="text-[12px] text-white/45">—</p>
          )}
        </Section>

        <Section title="Suggested commands" accent="cyan">
          {panel.suggestedCommands?.length ? (
            <ul className="space-y-1.5">
              {panel.suggestedCommands.map((c, i) => (
                <li key={i} className="mono text-[11.5px] text-cyan-100/85 flex items-center gap-2">
                  <span className="text-cyan-400/80">▸</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-white/45">—</p>
          )}
        </Section>
      </div>

      <div className="shrink-0 p-3 pt-2 border-t border-white/[0.08] bg-black/[0.18]">
        <div className="grid grid-cols-2 gap-2">
          <ActionBtn
            label="Copy Cursor prompt"
            variant="secondary"
            disabled={actionsDisabled || !hasCursor}
            onClick={onCopyCursor}
          />
          <ActionBtn
            label="Send to Claude Code"
            variant="amber"
            disabled={actionsDisabled || !hasClaude}
            onClick={onSendClaude}
          />
          <ActionBtn
            label="Execute with OpenClaw"
            variant="violet"
            disabled={actionsDisabled}
            onClick={onOpenClaw}
          />
          <ActionBtn
            label={safeCmd ? `Run: ${safeCmd}` : "Run safe command"}
            variant="primary"
            disabled={actionsDisabled || !safeCmd}
            onClick={() => safeCmd && onRunSafeCommand(safeCmd)}
          />
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  accent,
  children,
}: {
  title: string;
  accent: "emerald" | "sky" | "amber" | "violet" | "white" | "cyan";
  children: React.ReactNode;
}) {
  const dot =
    accent === "emerald" ? "bg-emerald-400"
    : accent === "sky" ? "bg-sky-400"
    : accent === "amber" ? "bg-amber-400"
    : accent === "violet" ? "bg-violet-400"
    : accent === "cyan" ? "bg-cyan-400"
    : "bg-white/60";
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        <span className="text-[9.5px] uppercase tracking-[0.14em] text-white/40 font-medium">{title}</span>
      </div>
      {children}
    </div>
  );
}

function ActionBtn({
  label,
  onClick,
  disabled,
  variant,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant: "primary" | "secondary" | "amber" | "violet";
}) {
  const cls =
    variant === "primary"
      ? "bg-white text-black hover:bg-white/92 border border-white/20 shadow-[0_0_20px_-4px_rgba(255,255,255,0.35)]"
    : variant === "amber"
      ? "bg-amber-500/88 text-black hover:bg-amber-400 border border-amber-300/40"
    : variant === "violet"
      ? "bg-violet-500/85 text-white hover:bg-violet-500 border border-violet-400/35 shadow-[0_0_18px_-6px_rgba(167,139,250,0.7)]"
      : "bg-white/[0.08] text-white/90 hover:bg-white/[0.13] border border-white/10";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={label}
      className={`h-9 px-2 rounded-xl text-[10.5px] font-semibold tracking-tight transition-all active:scale-[0.98]
        disabled:opacity-35 disabled:pointer-events-none ${cls}`}
    >
      <span className="block w-full truncate">{label}</span>
    </button>
  );
}
