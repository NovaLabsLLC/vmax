import React, { useCallback, useEffect, useState } from "react";

export type AgentUsageRow = {
  id: string;
  label: string;
  totalLifetime: number;
  totalToday: number;
  quotaDaily: number | null;
  remainingDaily: number | null;
};

type UsagePayload = {
  updatedAt?: number;
  agents?: AgentUsageRow[];
};

type Props = { className?: string };

/**
 * Per-agent dispatch counts (lifetime + today) and remaining daily quota (EXE-42).
 * Refreshes when main broadcasts `usage:updated` after each tracked dispatch.
 */
export default function AgentUsageStrip({ className = "" }: Props) {
  const [payload, setPayload] = useState<UsagePayload | null>(null);

  const refresh = useCallback(() => {
    if (typeof window.exec.getUsageSummary !== "function") return;
    void window.exec.getUsageSummary().then((d) => setPayload(d as UsagePayload));
  }, []);

  useEffect(() => {
    refresh();
    if (typeof window.exec.onUsageUpdated !== "function") return undefined;
    return window.exec.onUsageUpdated(() => refresh());
  }, [refresh]);

  const agents = payload?.agents;
  if (!agents || agents.length === 0) return null;

  return (
    <div
      className={`rounded-lg border border-white/[0.07] bg-black/25 px-2 py-2 ${className}`}
      aria-live="polite"
      aria-label="Coding agent usage"
    >
      <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/35 mb-1.5 px-0.5">
        Agent usage (today · lifetime · remaining)
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {agents.map((a) => {
          const cap = a.quotaDaily;
          const pct =
            cap !== null && cap > 0 ? Math.min(100, Math.round((a.totalToday / cap) * 100)) : null;
          const warn = a.remainingDaily !== null && a.remainingDaily <= 5 && cap !== null;
          return (
            <div
              key={a.id}
              className={`rounded-md border px-2 py-1.5 ${
                warn ? "border-amber-400/35 bg-amber-500/[0.06]" : "border-white/[0.06] bg-white/[0.03]"
              }`}
            >
              <div className="text-[11px] font-semibold text-white/88 truncate">{a.label}</div>
              <div className="text-[10px] text-white/50 mt-0.5 leading-snug">
                Today{" "}
                <span className="text-white/75 tabular-nums">
                  {a.totalToday}
                  {cap !== null ? ` / ${cap}` : ""}
                </span>
                {" · "}
                Lifetime <span className="text-white/75 tabular-nums">{a.totalLifetime}</span>
              </div>
              <div className="text-[10px] mt-1 leading-snug">
                <span className="text-white/42">Remaining today:</span>{" "}
                <span
                  className={`tabular-nums font-medium ${warn ? "text-amber-200/95" : "text-emerald-200/90"}`}
                >
                  {a.remainingDaily === null ? "∞" : a.remainingDaily}
                </span>
                {cap === null ? (
                  <span className="text-white/35"> (no daily cap)</span>
                ) : null}
              </div>
              {pct !== null ? (
                <div className="mt-1.5 h-1 rounded-full bg-white/[0.08] overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-[width] duration-300 ${
                      warn ? "bg-amber-400/85" : "bg-emerald-400/75"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
