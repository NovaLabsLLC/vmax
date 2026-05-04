import React from "react";
import type { RepoContext } from "../types";
import Chip, { BranchIcon, FilesIcon, FolderIcon } from "./Chip";

// Single-line repo summary with Raycast-style context chips.
export default function RepoStrip({ repo, onRescan }: { repo: RepoContext | null; onRescan: () => void }) {
  if (!repo) return null;
  if (!repo.ok) {
    return <div className="text-[11px] text-red-300/85">{repo.error}</div>;
  }
  return (
    <div className="flex items-center gap-1.5 px-0.5">
      <Chip icon={<FolderIcon />} title={repo.root}>{repo.name}</Chip>
      <Chip icon={<BranchIcon />} tone="branch" mono>{repo.branch}</Chip>
      <Chip icon={<FilesIcon />}>{repo.changedFiles.length} changed</Chip>
      <button
        onClick={onRescan}
        className="ml-auto h-[20px] w-[20px] rounded-full flex items-center justify-center
                   text-white/40 hover:text-white/85 hover:bg-white/[0.06] transition-colors"
        title="Rescan"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
      </button>
    </div>
  );
}
