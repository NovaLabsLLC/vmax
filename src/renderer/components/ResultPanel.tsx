import React from "react";
import type { Plan, FailureExplanation, DiffSummary } from "../types";

type Props = {
  kind: "idle" | "plan" | "failure" | "diff";
  plan?: Plan | null;
  failure?: FailureExplanation | null;
  diff?: DiffSummary | null;
  loading?: boolean;
  onCopyCursorPrompt?: (prompt: string) => void;
  onSendToCursor?: (prompt: string) => void;
  onRunCommand?: (cmd: string) => void;
};

export default function ResultPanel(props: Props) {
  const { kind, loading } = props;
  if (loading) return <Wrapper><Loading /></Wrapper>;
  if (kind === "idle") return <Wrapper><Idle /></Wrapper>;
  if (kind === "plan" && props.plan)
    return <Wrapper><PlanView {...props} plan={props.plan} /></Wrapper>;
  if (kind === "failure" && props.failure)
    return <Wrapper><FailureView {...props} failure={props.failure} /></Wrapper>;
  if (kind === "diff" && props.diff)
    return <Wrapper><DiffView diff={props.diff} /></Wrapper>;
  return <Wrapper><Idle /></Wrapper>;
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-4 min-h-[140px]">
      {children}
    </div>
  );
}

function Idle() {
  return (
    <div className="text-[12.5px] text-white/40 leading-relaxed">
      Run a command card to get a tactical plan, a failure explanation, or a diff summary here.
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center gap-2 text-[12.5px] text-white/55">
      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
      Thinking…
    </div>
  );
}

function PlanView({
  plan,
  onCopyCursorPrompt,
  onSendToCursor,
  onRunCommand,
}: { plan: Plan } & Props) {
  return (
    <div className="space-y-3">
      <Section label="Plan">
        <p className="text-[13px] text-white/85 leading-relaxed">{plan.summary}</p>
      </Section>

      {plan.files?.length > 0 && (
        <Section label={`Likely files (${plan.files.length})`}>
          <ul className="space-y-1">
            {plan.files.map((f) => (
              <li key={f.path} className="text-[12px]">
                <span className="mono text-emerald-300">{f.path}</span>
                <span className="text-white/55"> — {f.why}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {plan.risks?.length > 0 && (
        <Section label="Risks">
          <ul className="list-disc list-inside text-[12px] text-amber-200/85 space-y-0.5">
            {plan.risks.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </Section>
      )}

      {plan.command && (
        <Section label="Verify with">
          <div className="flex items-center gap-2">
            <code className="mono text-[12px] bg-black/40 border border-white/10 rounded px-2 py-1 text-white/85">{plan.command}</code>
            {onRunCommand && (
              <button
                onClick={() => onRunCommand(plan.command)}
                className="text-[11px] px-2 py-1 rounded bg-white/10 hover:bg-white/15 text-white"
              >
                Run
              </button>
            )}
          </div>
        </Section>
      )}

      {plan.cursorPrompt && (
        <CursorBlock
          prompt={plan.cursorPrompt}
          onCopy={onCopyCursorPrompt}
          onSend={onSendToCursor}
        />
      )}
    </div>
  );
}

function FailureView({
  failure,
  onCopyCursorPrompt,
  onSendToCursor,
}: { failure: FailureExplanation } & Props) {
  return (
    <div className="space-y-3">
      <Section label="What happened">
        <p className="text-[13px] text-white/90 leading-relaxed">{failure.what}</p>
      </Section>
      {failure.likelyFile && (
        <Section label="Likely file">
          <code className="mono text-[12.5px] text-emerald-300">{failure.likelyFile}</code>
        </Section>
      )}
      <Section label="Cause">
        <p className="text-[12.5px] text-white/80 leading-relaxed">{failure.cause}</p>
      </Section>
      {failure.next?.length > 0 && (
        <Section label="Next">
          <ul className="list-disc list-inside text-[12px] text-white/80 space-y-0.5">
            {failure.next.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        </Section>
      )}
      {failure.cursorPrompt && (
        <CursorBlock
          prompt={failure.cursorPrompt}
          onCopy={onCopyCursorPrompt}
          onSend={onSendToCursor}
        />
      )}
    </div>
  );
}

function DiffView({ diff }: { diff: DiffSummary }) {
  return (
    <div className="space-y-3">
      <Section label="Summary">
        <p className="text-[13px] text-white/85 leading-relaxed">{diff.summary}</p>
      </Section>
      {diff.files?.length > 0 && (
        <Section label={`Files (${diff.files.length})`}>
          <ul className="space-y-1">
            {diff.files.map((f) => (
              <li key={f.path} className="text-[12px]">
                <span className="mono text-emerald-300">{f.path}</span>
                <span className="text-white/55"> — {f.change}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {diff.risks?.length > 0 && (
        <Section label="Risks">
          <ul className="list-disc list-inside text-[12px] text-amber-200/85 space-y-0.5">
            {diff.risks.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </Section>
      )}
      {diff.nextChecks?.length > 0 && (
        <Section label="Next checks">
          <ul className="list-disc list-inside text-[12px] text-white/80 space-y-0.5">
            {diff.nextChecks.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9.5px] uppercase tracking-[0.14em] text-white/35 mb-1">{label}</div>
      {children}
    </div>
  );
}

function CursorBlock({
  prompt,
  onCopy,
  onSend,
}: {
  prompt: string;
  onCopy?: (prompt: string) => void;
  onSend?: (prompt: string) => void;
}) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="rounded-xl bg-black/45 border border-white/[0.08] p-3 relative overflow-hidden">
      {/* subtle inset glow */}
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="w-1 h-1 rounded-full bg-sky-400" />
          <div className="text-[9.5px] uppercase tracking-[0.14em] text-white/45">Cursor prompt</div>
        </div>
        <div className="flex items-center gap-1.5">
          {onCopy && (
            <button
              onClick={() => { onCopy(prompt); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
              className="text-[10.5px] px-2 h-[22px] rounded-md bg-white/[0.06] hover:bg-white/[0.1] active:bg-white/[0.14]
                         border border-white/[0.08] hover:border-white/15 text-white/85 transition-all flex items-center gap-1"
            >
              {copied ? "✓ Copied" : "Copy"}
            </button>
          )}
          {onSend && (
            <button
              onClick={() => onSend(prompt)}
              className="text-[10.5px] px-2.5 h-[22px] rounded-md bg-white text-black hover:bg-white/95 active:scale-[0.98]
                         transition-all flex items-center gap-1
                         shadow-[0_0_16px_-4px_rgba(255,255,255,0.5)]"
            >
              Send to Cursor
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="13 6 19 12 13 18" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <pre className="mono text-[12px] text-white/85 whitespace-pre-wrap leading-relaxed">{prompt}</pre>
    </div>
  );
}
