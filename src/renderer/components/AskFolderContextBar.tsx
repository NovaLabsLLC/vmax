import React from "react";

type Props = {
  /** Resolved absolute path shown when attachment is active */
  attachedPath: string | null;
  /** Short repo name from scan (e.g. directory name / git) */
  repoName?: string | null;
  /** Picker open or scanning the chosen folder */
  picking: boolean;
  /** Disable folder actions while Ask / plan flows are busy */
  freeze?: boolean;
  onPickFolder: () => void | Promise<void>;
  onClear: () => void;
};

/** Folder picker row for Workspace Ask: scans with `exec.scanRepo` and parent attaches summary to `exec.ask`. */
export default function AskFolderContextBar({
  attachedPath,
  repoName,
  picking,
  freeze = false,
  onPickFolder,
  onClear,
}: Props) {
  const trimmed = attachedPath?.trim() || "";
  const pickDisabled = picking || freeze;
  const tail =
    trimmed.length > 52 ? `\u2026${trimmed.slice(-48)}` : trimmed || "";

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 rounded-xl border border-white/[0.07] bg-white/[0.02]">
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/42 shrink-0">
        Ask · folder
      </span>
      {!trimmed ? (
        <>
          <span className="text-[11px] text-white/50 flex-1 min-w-[12rem]">
            Optional git folder — attaches a bounded snapshot so Ask can reference the tree.
          </span>
          <button
            type="button"
            disabled={pickDisabled}
            onClick={() => void onPickFolder()}
            className="shrink-0 text-[11px] px-2.5 h-[24px] rounded-md bg-white/[0.08] hover:bg-white/[0.12] border border-white/[0.1] text-white/90 disabled:opacity-45"
          >
            {picking ? "Scanning…" : freeze ? "Wait…" : "Pick folder"}
          </button>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            <span
              className="text-[11px] text-emerald-100/95 font-medium truncate"
              title={trimmed}
            >
              {repoName?.trim() || "Git repo"}
            </span>
            <span className="text-[10px] text-white/40 mono truncate" title={trimmed}>
              {tail}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <button
              type="button"
              disabled={pickDisabled}
              onClick={() => void onPickFolder()}
              className="text-[10px] px-2 h-[22px] rounded-md bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-white/78"
            >
              {picking ? "…" : "Change"}
            </button>
            <button
              type="button"
              disabled={picking}
              onClick={onClear}
              className="text-[10px] px-2 h-[22px] rounded-md bg-rose-500/10 hover:bg-rose-500/18 border border-rose-400/22 text-rose-100/95"
            >
              Clear
            </button>
          </div>
        </>
      )}
    </div>
  );
}
