import React from "react";
import Chip, { FolderIcon } from "./Chip";

type Props = {
  path: string | null;
  /** Display name (folder or scanned repo name) */
  label: string | null;
  busy?: boolean;
  onSelectRepo: () => void;
};

/** App-wide saved coding repo: native picker + context chip. */
export default function RepoContextStrip({ path, label, busy, onSelectRepo }: Props) {
  const chipTitle = path || undefined;
  const displayLabel =
    label
    || (path ? path.replace(/[/\\]+$/, "").split(/[/\\]/).filter(Boolean).pop() || path : null)
    || "No repo selected";

  return (
    <div className="no-drag shrink-0 flex items-center gap-2.5 px-4 py-2 border-b border-white/[0.06] bg-[#0c0c0f]/95">
      <span className="text-[10px] uppercase tracking-[0.12em] text-white/35 font-medium whitespace-nowrap">
        Coding repo
      </span>
      <Chip
        icon={<FolderIcon />}
        tone={path ? "success" : "default"}
        title={chipTitle}
        mono={!!path}
      >
        {displayLabel}
      </Chip>
      <button
        type="button"
        onClick={onSelectRepo}
        disabled={busy}
        className={`h-8 px-3.5 rounded-lg text-[12px] font-medium tracking-tight
          bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.1] text-white/90
          disabled:opacity-50 disabled:cursor-not-allowed transition-colors`}
      >
        {busy ? "Selecting…" : "Select Repo"}
      </button>
    </div>
  );
}
