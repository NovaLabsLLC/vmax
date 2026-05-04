import React from "react";

type Props = {
  children: React.ReactNode;
  icon?: React.ReactNode;
  tone?: "default" | "branch" | "warn" | "success";
  mono?: boolean;
  title?: string;
};

// Raycast/Cursor-style context chip — small pill with optional leading icon.
export default function Chip({ children, icon, tone = "default", mono, title }: Props) {
  const toneClass =
    tone === "branch"
      ? "text-emerald-300/90 bg-emerald-400/[0.08] border-emerald-400/15"
      : tone === "warn"
      ? "text-amber-200/90 bg-amber-400/[0.08] border-amber-400/15"
      : tone === "success"
      ? "text-emerald-300/90 bg-emerald-400/[0.08] border-emerald-400/15"
      : "text-white/75 bg-white/[0.05] border-white/[0.08]";
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 h-[20px] px-2 rounded-full border
                  text-[10.5px] font-medium ${mono ? "mono" : ""} ${toneClass}`}
    >
      {icon && <span className="opacity-90">{icon}</span>}
      <span className="truncate max-w-[160px]">{children}</span>
    </span>
  );
}

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
export function BranchIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" {...stroke}>
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <path d="M18 8a9 9 0 0 1-9 9" />
    </svg>
  );
}
export function FilesIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" {...stroke}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <polyline points="14 3 14 8 19 8" />
    </svg>
  );
}
export function FolderIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" {...stroke}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}
export function PulseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" {...stroke}>
      <polyline points="3 12 7 12 10 5 14 19 17 12 21 12" />
    </svg>
  );
}
