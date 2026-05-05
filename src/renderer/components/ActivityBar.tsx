import React, { useEffect, useState } from "react";

export type Activity = {
  kind: "plan" | "failure" | "diff" | "run" | "cursor" | "voice" | "openclaw";
  label: string;
  startedAt: number;
};

const tones: Record<Activity["kind"], { bg: string; ring: string; dot: string; sweep: string }> = {
  plan:    { bg: "bg-emerald-500/[0.07]",  ring: "ring-emerald-400/25",  dot: "bg-emerald-400", sweep: "via-emerald-400/15" },
  failure: { bg: "bg-amber-500/[0.07]",    ring: "ring-amber-400/30",    dot: "bg-amber-400",   sweep: "via-amber-400/15" },
  diff:    { bg: "bg-sky-500/[0.07]",      ring: "ring-sky-400/25",      dot: "bg-sky-400",     sweep: "via-sky-400/15" },
  run:     { bg: "bg-emerald-500/[0.07]",  ring: "ring-emerald-400/25",  dot: "bg-emerald-400", sweep: "via-emerald-400/15" },
  cursor:  { bg: "bg-white/[0.04]",        ring: "ring-white/15",        dot: "bg-white",       sweep: "via-white/15" },
  voice:   { bg: "bg-emerald-500/[0.07]",  ring: "ring-emerald-400/25",  dot: "bg-emerald-400", sweep: "via-emerald-400/15" },
  openclaw: { bg: "bg-violet-500/[0.09]",   ring: "ring-violet-400/30",   dot: "bg-violet-400",  sweep: "via-violet-400/20" },
};

export default function ActivityBar({
  activity,
  resultFlash,
}: {
  activity: Activity | null;
  resultFlash?: { tone: "ok" | "err"; text: string } | null;
}) {
  // Re-render every 100ms so the elapsed timer ticks while an op is running.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!activity) return;
    const i = window.setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(i);
  }, [activity]);

  if (activity) {
    const tone = tones[activity.kind];
    const elapsed = ((Date.now() - activity.startedAt) / 1000).toFixed(1);

    return (
      <div className={`relative overflow-hidden rounded-xl ring-1 ring-inset ${tone.ring} ${tone.bg} px-3 py-2 flex items-center gap-2.5`}>
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl z-0">
          <div
            className={`absolute inset-y-0 w-[40%] bg-gradient-to-r from-transparent ${tone.sweep} to-transparent`}
            style={{ animation: "shimmer-sweep 1.6s linear infinite" }}
          />
        </div>

        <span className="relative z-10 flex">
          <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
          <span className={`absolute inset-0 w-1.5 h-1.5 rounded-full ${tone.dot} animate-ping opacity-60`} />
        </span>

        <span className="relative z-10 text-[12.5px] text-white/90 font-medium tracking-tight">{activity.label}</span>
        <span className="relative z-10 ml-auto text-[10.5px] mono text-white/50 tabular-nums">{elapsed}s</span>
      </div>
    );
  }

  if (resultFlash) {
    const ok = resultFlash.tone === "ok";
    return (
      <div
        className={`rounded-xl ring-1 ring-inset px-3 py-2 flex items-center gap-2.5
          ${ok ? "bg-emerald-500/[0.09] ring-emerald-400/25" : "bg-red-500/[0.09] ring-red-400/30"}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ok ? "bg-emerald-400" : "bg-red-400"}`} />
        <span className={`text-[12.5px] font-medium tracking-tight ${ok ? "text-emerald-100/95" : "text-red-100/95"}`}>
          {resultFlash.text}
        </span>
      </div>
    );
  }

  return null;
}
