import React from "react";

export type Msg = { role: "user" | "assistant"; text: string; ts?: number };

export default function MessageThread({
  messages,
  pending,
}: { messages: Msg[]; pending?: boolean }) {
  if (messages.length === 0 && !pending) return null;
  return (
    <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-3 space-y-2">
      <div className="text-[10px] uppercase tracking-[0.14em] text-white/40 mb-1">Conversation</div>
      <div className="max-h-[360px] overflow-y-auto term-scroll pr-1.5 space-y-2">
        {messages.map((m, i) => (
          <Bubble key={i} role={m.role} text={m.text} />
        ))}
        {pending && (
          <div className="rounded-xl border border-violet-300/15 bg-violet-500/[0.06] px-3 py-2">
            <div className="text-[9.5px] uppercase tracking-[0.14em] text-violet-200/85 mb-0.5">Exec</div>
            <div className="flex items-center gap-2 text-[12px] text-white/55">
              <div className="w-1.5 h-1.5 rounded-full bg-violet-300 animate-pulse" />
              Thinking…
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Bubble({ role, text }: { role: "user" | "assistant"; text: string }) {
  if (role === "user") {
    return (
      <div className="rounded-xl bg-white/[0.06] border border-white/[0.08] px-3 py-2">
        <div className="text-[9.5px] uppercase tracking-[0.14em] text-emerald-200/80 mb-0.5">You</div>
        <p className="text-[12.5px] text-white/95 leading-relaxed whitespace-pre-wrap">{text}</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl bg-violet-500/[0.06] border border-violet-300/15 px-3 py-2">
      <div className="text-[9.5px] uppercase tracking-[0.14em] text-violet-200/85 mb-0.5">Exec</div>
      <p className="text-[12.5px] text-white/95 leading-relaxed whitespace-pre-wrap">{text}</p>
    </div>
  );
}
