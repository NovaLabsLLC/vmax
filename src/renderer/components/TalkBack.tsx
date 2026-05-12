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
    <div className="flex flex-col gap-3">
      {bubbles.slice(-4).map((b) => (
        <div
          key={b.id}
          className={`text-[11px] leading-snug pl-3 border-l border-white/[0.08]
            ${b.tone === "warn"
              ? "text-amber-200/65 border-l-amber-400/25"
              : b.tone === "success"
                ? "text-emerald-200/60 border-l-emerald-400/28"
                : "text-white/48 border-l-white/[0.12]"}`}
        >
          {b.text}
        </div>
      ))}
    </div>
  );
}
