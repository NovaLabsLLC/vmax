import React from "react";

export type Bubble = {
  id: string;
  text: string;
  tone?: "info" | "warn" | "success";
  ts: number;
};

export default function TalkBack({ bubbles }: { bubbles: Bubble[] }) {
  if (bubbles.length === 0) return null;
  return (
    <div className="space-y-1">
      {bubbles.slice(-4).map((b) => (
        <div
          key={b.id}
          className={`text-[12px] leading-relaxed rounded-lg px-3 py-1.5 inline-block
            ${b.tone === "warn" ? "bg-amber-500/10 text-amber-200/95 border border-amber-400/20"
              : b.tone === "success" ? "bg-emerald-500/10 text-emerald-200/95 border border-emerald-400/20"
              : "bg-white/[0.04] text-white/80 border border-white/[0.06]"}`}
        >
          {b.text}
        </div>
      ))}
    </div>
  );
}
