import React, { useEffect, useState } from "react";
import type { AgentUsageRow } from "./AgentUsageStrip";

export type UsageSummaryPayload = {
  updatedAt: number;
  totals: Record<string, number>;
  byAgent: Record<string, number>;
  agents?: AgentUsageRow[];
};

type Props = {
  /** Bump to refetch after a local action that updates stats. */
  bumpEpoch?: number;
  /** Tighter spacing when nested in dense cards */
  dense?: boolean;
};

export default function UsageSummaryStrip({ bumpEpoch = 0, dense }: Props) {
  const [data, setData] = useState<UsageSummaryPayload | null>(null);

  useEffect(() => {
    if (typeof window.exec.getUsageSummary !== "function") return undefined;
    let cancelled = false;
    void window.exec.getUsageSummary().then((d) => {
      if (!cancelled) setData(d as UsageSummaryPayload);
    });
    return () => {
      cancelled = true;
    };
  }, [bumpEpoch]);

  useEffect(() => {
    if (typeof window.exec.onUsageUpdated !== "function") return undefined;
    return window.exec.onUsageUpdated(() => {
      void window.exec.getUsageSummary().then((d) => setData(d as UsageSummaryPayload));
    });
  }, []);

  if (typeof window.exec.getUsageSummary !== "function") return null;

  const totals = data?.totals || {};
  const by = data?.byAgent || {};

  const n = (k: string) => Number(totals[k]) || 0;
  const anyAgent = Number(by.claude || 0) + Number(by.codex || 0) + Number(by.cursor || 0) > 0;

  const taskOk = n("task_create_ok");
  const taskAll = taskOk + n("task_create_fail");
  const shipOk = n("structured_task_ok");
  const shipAll = shipOk + n("structured_task_fail");
  const pill = n("pill_dispatch");
  const ch = n("cursor_handoff");

  const parts: string[] = [];
  if (taskAll > 0) parts.push(`Task plans ${taskAll} (${taskOk} ok)`);
  if (shipAll > 0) parts.push(`Ship → agents ${shipAll} (${shipOk} ok)`);
  if (pill > 0) parts.push(`Pill routing ${pill}`);
  if (ch > 0) parts.push(`Cursor sends ${ch}`);
  const agents = data?.agents;
  if (agents && agents.length > 0) {
    parts.push(
      agents
        .map(
          (a) =>
            `${a.label}: Σ${a.totalLifetime} · today ${a.totalToday}${a.quotaDaily != null ? `/${a.quotaDaily}` : ""} · left ${a.remainingDaily === null ? "∞" : a.remainingDaily}`,
        )
        .join(" · "),
    );
  } else if (anyAgent || parts.length > 0) {
    parts.push(`Runs Claude ${Number(by.claude) || 0} · Codex ${Number(by.codex) || 0} · Cursor ${Number(by.cursor) || 0}`);
  }

  const body = parts.length ? parts.join(" · ") : "Counts update as you ship tasks, use pill routing, and send to Cursor — all stored locally on this Mac.";

  return (
    <div
      className={
        dense
          ? "rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-1.5"
          : "rounded-lg border border-white/[0.07] bg-white/[0.02] px-2.5 py-2 mt-2"
      }
    >
      <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/35 mb-0.5">
        Usage (local)
      </div>
      <div className="text-[10px] text-white/50 leading-snug">{body}</div>
    </div>
  );
}
