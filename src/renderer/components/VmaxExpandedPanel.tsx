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
  onSendCursor?: () => void;
  onOpenClaw: () => void;
  onRunSafeCommand: (command: string) => void;
};

export default function VmaxExpandedPanel({
  question,
  panel,
  parseWarning,
  actionsDisabled,
  onCollapse,
  onSendCursor,
}: VmaxExpandedPanelProps) {
  const hasPrompt = !!panel.cursorPrompt?.trim() || !!panel.claudePrompt?.trim();

  return (
    <div
      className="no-drag flex flex-col rounded-[16px] overflow-hidden
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

      <div className="px-3.5 py-3 space-y-3 max-h-[640px] overflow-y-auto">
        {panel.nextSteps?.length ? (
          <ol className="space-y-3 text-[13px] text-white/88 list-none pl-0">
            {panel.nextSteps.map((s, i) => (
              <Step key={i} index={i + 1} text={s} />
            ))}
          </ol>
        ) : (
          <p className="text-[12px] text-white/45">No steps yet.</p>
        )}
        {panel.cursorPrompt?.trim() ? (
          <CursorPromptBlock text={panel.cursorPrompt.trim()} />
        ) : null}
        {hasPrompt && onSendCursor ? (
          <button
            type="button"
            disabled={actionsDisabled}
            onClick={onSendCursor}
            className="w-full h-9 rounded-xl text-[12px] font-semibold tracking-tight transition-all active:scale-[0.99]
                       bg-violet-500/85 hover:bg-violet-500 text-white border border-violet-300/40
                       shadow-[0_0_18px_-6px_rgba(167,139,250,0.7)]
                       disabled:opacity-40 disabled:pointer-events-none
                       flex items-center justify-center gap-2"
            title="Open Cursor and paste this prompt into the agent"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
            Build it in Cursor
          </button>
        ) : null}
      </div>
    </div>
  );
}

// Parses a step string into prose + extracted commands (`...`) and code
// fences (```...```). Renders inline-`code` as a copy chip and ``` blocks as a
// dedicated copy box. Designed for non-coders: the chip / box is the action.
type Token =
  | { kind: "text"; value: string }
  | { kind: "inline"; value: string }
  | { kind: "block"; lang: string; value: string }
  | { kind: "link"; label: string; href: string };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const fence = /```(\w+)?\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text)) !== null) {
    if (m.index > last) tokens.push(...splitInline(text.slice(last, m.index)));
    tokens.push({ kind: "block", lang: m[1] || "", value: m[2].trim() });
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push(...splitInline(text.slice(last)));
  return tokens;
}

// Interleave inline-code and link parsing. We extract markdown links and bare
// URLs first (they may contain characters that break code matching), then
// scan remaining text for backtick spans.
function splitInline(s: string): Token[] {
  const out: Token[] = [];
  // [label](https://…)  OR  bare https://…
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(s)) !== null) {
    if (m.index > last) out.push(...splitCode(s.slice(last, m.index)));
    if (m[1] && m[2]) {
      out.push({ kind: "link", label: m[1], href: m[2] });
    } else if (m[3]) {
      out.push({ kind: "link", label: m[3], href: m[3] });
    }
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(...splitCode(s.slice(last)));
  return out;
}

function splitCode(s: string): Token[] {
  const out: Token[] = [];
  const re = /`([^`\n]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push({ kind: "text", value: s.slice(last, m.index) });
    out.push({ kind: "inline", value: m[1] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ kind: "text", value: s.slice(last) });
  return out;
}

function Step({ index, text }: { index: number; text: string }) {
  const tokens = tokenize(text);
  return (
    <li className="flex gap-2.5 items-start">
      <span className="shrink-0 mt-[1px] inline-flex w-5 h-5 items-center justify-center rounded-full
                       bg-white/[0.08] border border-white/12 text-[10.5px] font-semibold text-white/80">
        {index}
      </span>
      <div className="min-w-0 flex-1 leading-snug">
        {tokens.map((t, i) =>
          t.kind === "text" ? (
            <span key={i}>{t.value}</span>
          ) : t.kind === "inline" ? (
            <CopyChip key={i} text={t.value} />
          ) : t.kind === "link" ? (
            <LinkChip key={i} label={t.label} href={t.href} />
          ) : (
            <CopyBlock key={i} text={t.value} lang={t.lang} />
          )
        )}
      </div>
    </li>
  );
}

function CopyChip({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  const onClick = () => {
    void window.exec.copy(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1100);
  };
  return (
    <button
      type="button"
      onClick={onClick}
      title="Click to copy"
      className={`mono align-baseline mx-0.5 px-1.5 py-[1px] rounded-md text-[12px] border transition-colors
        ${copied
          ? "bg-emerald-500/25 text-emerald-100 border-emerald-300/35"
          : "bg-white/[0.07] text-white/95 border-white/14 hover:bg-white/[0.13]"}`}
    >
      {copied ? "copied" : text}
    </button>
  );
}

function CursorPromptBlock({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  const onClick = () => {
    void window.exec.copy(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="rounded-xl border border-violet-400/25 bg-violet-500/[0.07] overflow-hidden">
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-violet-300/15">
        <span className="text-[9.5px] uppercase tracking-[0.14em] text-violet-200/80 font-semibold">
          Cursor prompt — paste to build it
        </span>
        <button
          type="button"
          onClick={onClick}
          className={`text-[10.5px] px-2 py-0.5 rounded-md border transition-colors
            ${copied
              ? "bg-emerald-500/25 text-emerald-100 border-emerald-300/35"
              : "bg-violet-500/15 text-violet-100 border-violet-300/30 hover:bg-violet-500/25"}`}
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="text-[11.5px] text-violet-50/95 whitespace-pre-wrap leading-relaxed px-2.5 py-2">
{text}
      </pre>
    </div>
  );
}

function LinkChip({ label, href }: { label: string; href: string }) {
  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    void window.exec.openUrl?.(href);
  };
  return (
    <a
      href={href}
      onClick={onClick}
      title={href}
      className="align-baseline mx-0.5 px-1.5 py-[1px] rounded-md text-[12px] border transition-colors
                 bg-sky-500/15 text-sky-100 border-sky-300/30 hover:bg-sky-500/25 inline-flex items-center gap-1"
    >
      <span>{label}</span>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <path d="M7 17L17 7M9 7h8v8" />
      </svg>
    </a>
  );
}

function CopyBlock({ text, lang }: { text: string; lang: string }) {
  const [copied, setCopied] = React.useState(false);
  const onClick = () => {
    void window.exec.copy(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1100);
  };
  return (
    <div className="my-2 rounded-xl border border-white/12 bg-black/45 overflow-hidden">
      <div className="flex items-center justify-between px-2.5 py-1 border-b border-white/[0.06]">
        <span className="text-[9.5px] uppercase tracking-[0.14em] text-white/45">{lang || "code"}</span>
        <button
          type="button"
          onClick={onClick}
          className={`text-[10.5px] px-2 py-0.5 rounded-md border transition-colors
            ${copied
              ? "bg-emerald-500/25 text-emerald-100 border-emerald-300/35"
              : "bg-white/[0.06] text-white/85 border-white/12 hover:bg-white/[0.12]"}`}
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="mono text-[11.5px] text-white/90 whitespace-pre-wrap leading-relaxed px-2.5 py-2 max-h-[160px] overflow-auto">
{text}
      </pre>
    </div>
  );
}
