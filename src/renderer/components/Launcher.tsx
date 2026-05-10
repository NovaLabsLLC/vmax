import React from "react";

type Props = {
  active: boolean;
  busy: boolean;
  repoName: string | null;
  branch: string | null;
  onStart: () => void;
  onChangeRepo: () => void;
  onClose: () => void;
  expanded: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
};

export default function Launcher({
  active,
  busy,
  repoName,
  branch,
  onStart,
  onChangeRepo,
  onClose,
  expanded,
  onMouseEnter,
  onMouseLeave,
}: Props) {
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="pointer-events-auto mx-auto mb-3 rounded-[18px]
                 bg-gradient-to-b from-white/[0.05] to-transparent
                 ring-1 ring-white/10
                 shadow-[0_22px_55px_-20px_rgba(0,0,0,0.9),0_0_0_1px_rgba(255,255,255,0.02)_inset]
                 backdrop-blur-2xl
                 px-2.5 py-2.5 flex items-center gap-2
                 w-[min(420px,88vw)]
                 relative overflow-hidden"
    >
      {/* underlying tinted fill (separate from gradient border) */}
      <div className="absolute inset-0 -z-10 rounded-[18px] bg-[#070709]/96" />

      {!active ? (
        <>
          <div className="text-[12px] text-white/55 tracking-tight ml-0.5 leading-tight">
            <span className="text-white/85 font-semibold">Vmax</span>
            <span className="text-white/35"> · control layer</span>
          </div>
          <button
            onClick={onStart}
            disabled={busy}
            className={`ml-auto group h-8 pl-3.5 pr-3 rounded-full text-[12px] font-medium tracking-tight
              bg-white text-black hover:bg-white/95 active:scale-[0.98]
              transition-all duration-150
              shadow-[0_0_24px_-4px_rgba(255,255,255,0.55),0_2px_6px_rgba(0,0,0,0.4)]
              flex items-center gap-1.5
              ${busy ? "opacity-60 cursor-wait" : ""}`}
          >
            {busy ? "Starting…" : "Start Vmax"}
            {!busy && (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="-mr-0.5 transition-transform group-hover:translate-x-0.5">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="13 6 19 12 13 18" />
              </svg>
            )}
          </button>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 min-w-0 pl-1">
            <span className="relative flex">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping opacity-60" />
            </span>
            <div className="text-[12px] text-white/85 truncate tracking-tight">
              <span className="text-white/45">watching</span>{" "}
              <span className="text-white">{repoName}</span>
              {branch && <span className="text-white/30 mono"> · </span>}
              {branch && <span className="text-emerald-300/95 mono">{branch}</span>}
            </div>
          </div>

          <button
            onClick={onChangeRepo}
            title="Change repo"
            className="ml-1 text-[10.5px] text-white/45 hover:text-white px-2 h-[22px] rounded-full
                       bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/20
                       transition-all"
          >
            Change
          </button>

          <button
            onClick={onClose}
            className="ml-auto h-8 w-8 rounded-full flex items-center justify-center
                       text-white/65 hover:text-white hover:bg-white/[0.07] active:bg-white/10 transition-all"
            title={expanded ? "Collapse" : "Expand"}
          >
            <svg
              width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"
              className="transition-transform duration-300"
              style={{ transform: expanded ? "rotate(0deg)" : "rotate(180deg)" }}
            >
              <polyline points="6 15 12 9 18 15" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}
