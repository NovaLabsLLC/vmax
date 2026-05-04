import React from "react";

type Props = {
  task: string;
  onTaskChange: (v: string) => void;
  onSend: () => void;
  sending?: boolean;
  disabled?: boolean;
};

export default function TaskPanel({ task, onTaskChange, onSend, sending, disabled }: Props) {
  const canSend = !disabled && !sending && task.trim().length > 0;
  return (
    <div className="relative rounded-2xl bg-white/[0.03] border border-white/[0.06] p-3 pr-12">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] uppercase tracking-[0.14em] text-white/40">Task</div>
        <div className="text-[10px] text-white/30">paste from Linear / etc.</div>
      </div>
      <textarea
        value={task}
        onChange={(e) => onTaskChange(e.target.value)}
        onKeyDown={(e) => {
          // ⌘/Ctrl + Enter sends; bare Enter inserts newline (paragraphs from tickets)
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSend) {
            e.preventDefault();
            onSend();
          }
        }}
        disabled={disabled}
        placeholder="Add RevenueCat paywall flow"
        rows={2}
        className="w-full bg-transparent outline-none border-none resize-none
                   text-[13px] text-white placeholder-white/30 leading-relaxed
                   focus:placeholder-white/40"
      />

      <button
        onClick={onSend}
        disabled={!canSend}
        title="Plan Task (⌘ Enter)"
        className={`absolute right-2.5 bottom-2.5 h-8 w-8 rounded-full flex items-center justify-center
                    transition-all
                    ${canSend
                      ? "bg-white text-black hover:bg-white/90 shadow-[0_0_18px_-4px_rgba(255,255,255,0.5)]"
                      : "bg-white/10 text-white/30 cursor-not-allowed"}
                    ${sending ? "animate-pulse" : ""}`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="20" x2="12" y2="5" />
          <polyline points="6 11 12 5 18 11" />
        </svg>
      </button>
    </div>
  );
}
