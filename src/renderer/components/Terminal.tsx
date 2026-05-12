import React, { useEffect, useRef } from "react";

type Line = { stream: "stdout" | "stderr" | "meta"; text: string };

type Props = {
  lines: Line[];
  running: boolean;
  command: string | null;
  exitCode: number | null;
  onCancel: () => void;
  onClear: () => void;
};

export default function Terminal({ lines, running, command, exitCode, onCancel, onClear }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <div className="relative rounded-[18px] backdrop-blur-2xl
                    ring-1 ring-white/10
                    shadow-[0_18px_50px_-20px_rgba(0,0,0,0.8)]
                    flex flex-col h-[200px] overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-[#070709]/97" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-white/[0.04] via-transparent to-transparent" />
      <span className="pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
      <div className="relative h-8 px-3 flex items-center gap-2 border-b border-white/[0.06]">
        {running && (
          <div
            className="absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden pointer-events-none"
            aria-hidden
          >
            <div
              className="h-full w-[35%] bg-gradient-to-r from-transparent via-emerald-400/70 to-transparent"
              style={{ animation: "shimmer-sweep 1.2s linear infinite" }}
            />
          </div>
        )}
        <div className="text-[10px] uppercase tracking-[0.14em] text-white/45">Terminal</div>
        {command && (
          <div className="ml-2 mono text-[11px] text-white/55 truncate">$ {command}</div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {running ? (
            <button
              onClick={onCancel}
              className="text-[10px] px-2 py-0.5 rounded bg-red-500/15 text-red-300 hover:bg-red-500/25"
            >
              Stop
            </button>
          ) : exitCode !== null ? (
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded
                ${exitCode === 0 ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}
            >
              exit {exitCode}
            </span>
          ) : null}
          <button
            onClick={onClear}
            className="text-[10px] px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-white/60"
          >
            Clear
          </button>
        </div>
      </div>

      <div ref={ref} className="flex-1 overflow-y-auto term-scroll px-3 py-2">
        {lines.length === 0 ? (
          <div className="text-[11.5px] text-white/30 mono">(no output)</div>
        ) : (
          <pre className="mono text-[11.5px] leading-snug whitespace-pre-wrap">
            {lines.map((l, i) => (
              <span
                key={i}
                className={
                  l.stream === "stderr" ? "text-red-300/95"
                  : l.stream === "meta" ? "text-white/55"
                  : "text-white/80"
                }
              >
                {l.text}
              </span>
            ))}
          </pre>
        )}
      </div>
    </div>
  );
}
