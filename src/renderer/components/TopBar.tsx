import React from "react";

type Props = {
  active: boolean;
  busy: boolean;
  repoName: string | null;
  branch: string | null;
  onStart: () => void;
  onChangeRepo: () => void;
};

export default function TopBar({ active, busy, repoName, branch, onStart, onChangeRepo }: Props) {
  return (
    <div className="drag h-12 flex items-center px-4 border-b border-white/5 bg-[#0d0d10] select-none">
      <div className="pl-16 text-[13px] font-semibold tracking-tight text-white/85">
        Exec
      </div>
      <div className="ml-3 text-[11px] text-white/40">control layer for coding agents</div>

      <div className="ml-auto flex items-center gap-3">
        {active && repoName && (
          <div className="text-[12px] text-white/65 flex items-center gap-2">
            <span className="text-white/45">watching</span>{" "}
            <span className="text-white">{repoName}</span>
            {branch && <span className="text-white/40"> · {branch}</span>}
            <button
              onClick={onChangeRepo}
              className="no-drag text-[10.5px] text-white/45 hover:text-white/85 px-1.5 py-0.5 rounded border border-white/10 hover:border-white/25"
              title="Switch to a different repo"
            >
              Change
            </button>
          </div>
        )}
        <button
          onClick={onStart}
          disabled={busy}
          className={`no-drag h-8 px-4 rounded-full text-[12.5px] font-medium tracking-tight
            transition-all
            ${active
              ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30"
              : "bg-white text-black hover:bg-white/90 shadow-[0_0_24px_-4px_rgba(255,255,255,0.4)]"}
            ${busy ? "opacity-60 cursor-wait" : ""}`}
        >
          {busy ? "Starting…" : active ? "● Running" : "Start Exec"}
        </button>
      </div>
    </div>
  );
}
