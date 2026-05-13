import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentRunState, AgentStatusEvent, ExecAgent, VmaxTaskRunRecord } from "../types";
import AgentUsageStrip from "./AgentUsageStrip";
import AgentsConnectionGraph, { type AgentsCliPayload } from "./AgentsConnectionGraph";

type RowSource = "task" | "dispatch";

type AgentLiveRow = {
  runId: string;
  source: RowSource;
  agent: ExecAgent | null;
  title: string;
  subtitle?: string;
  taskStatus?: VmaxTaskRunRecord["status"];
  dispatchState?: AgentStatusEvent["state"];
  transcript: string;
  truncated: boolean;
  exitCode: number | null;
  error: string | null;
  updatedAt: number;
};

const MAX_ROWS = 24;
const MAX_TRANSCRIPT = 56_000;

function appendLimited(prev: string, add: string): { text: string; truncatedFlag: boolean } {
  const next = prev + add;
  if (next.length <= MAX_TRANSCRIPT) return { text: next, truncatedFlag: false };
  return { text: next.slice(-MAX_TRANSCRIPT), truncatedFlag: true };
}

function normalizeAgent(a: unknown): ExecAgent | null {
  const s = String(a || "").toLowerCase();
  if (s === "claude") return "claude";
  if (s === "codex") return "codex";
  if (s === "cursor") return "cursor";
  return null;
}

function pruneRows(map: Map<string, AgentLiveRow>): Map<string, AgentLiveRow> {
  if (map.size <= MAX_ROWS) return map;
  const sorted = [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  const keep = new Set(sorted.slice(0, MAX_ROWS).map((r) => r.runId));
  const next = new Map<string, AgentLiveRow>();
  for (const [id, row] of map) {
    if (keep.has(id)) next.set(id, row);
  }
  return next;
}

function rowRunning(r: AgentLiveRow): boolean {
  if (r.source === "task") {
    return ["created", "routed", "triggered", "running"].includes(r.taskStatus || "");
  }
  return r.dispatchState === "running";
}

function statusLabel(r: AgentLiveRow): string {
  if (r.source === "task") return r.taskStatus || "…";
  if (r.dispatchState === "done") return "done";
  if (r.dispatchState === "error") return "error";
  if (r.dispatchState === "running") return "running";
  return r.dispatchState || "…";
}

function statusTone(r: AgentLiveRow): "run" | "ok" | "err" | "idle" {
  if (rowRunning(r)) return "run";
  if (r.source === "task") {
    if (r.taskStatus === "completed") return "ok";
    if (r.taskStatus === "failed") return "err";
  }
  if (r.dispatchState === "done") return "ok";
  if (r.dispatchState === "error") return "err";
  return "idle";
}

const FILTER_KEYS: readonly (ExecAgent | "all")[] = ["all", "claude"];

type Props = { className?: string };

/**
 * Streams `exec:run:*` keyed by runId alongside `task:status` and `agents:status`
 * so parallel agent runs stay visible together.
 */
export default function LiveAgentsPanel({ className = "" }: Props) {
  const [rows, setRows] = useState<Map<string, AgentLiveRow>>(() => new Map());
  const [filter, setFilter] = useState<ExecAgent | "all">("all");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [bridgeCli, setBridgeCli] = useState<AgentsCliPayload | null>(null);
  const [bridgeLive, setBridgeLive] = useState<Partial<Record<ExecAgent, AgentRunState>>>({});

  const upsert = useCallback((runId: string, patch: Partial<AgentLiveRow>) => {
    if (!runId) return;
    setRows((prev) => {
      const next = new Map(prev);
      const existing: AgentLiveRow =
        next.get(runId) ||
        ({
          runId,
          source: "task",
          agent: null,
          title: "Agent run",
          transcript: "",
          truncated: false,
          exitCode: null,
          error: null,
          updatedAt: Date.now(),
        } as AgentLiveRow);
      next.set(runId, { ...existing, ...patch, runId, updatedAt: Date.now() });
      return pruneRows(next);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void window.exec.taskList().then((list) => {
      if (cancelled || !Array.isArray(list)) return;
      const cutoff = Date.now() - 3_600_000;
      for (const r of list) {
        if (!r?.runId || (r.updatedAt ?? 0) < cutoff) continue;
        upsert(r.runId, {
          source: "task",
          agent: r.selectedAgent,
          title: r.task?.title || "Structured task",
          subtitle: r.routingReason,
          taskStatus: r.status,
          error: r.error,
          exitCode: r.code ?? null,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [upsert]);

  useEffect(() => {
    let cancelled = false;
    void window.exec.cliStatus().then((c: AgentsCliPayload) => {
      if (!cancelled) setBridgeCli(c);
    }).catch(() => {
      if (!cancelled) setBridgeCli(null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const offTask = window.exec.onTaskStatus((r: VmaxTaskRunRecord) => {
      const runId = r.runId || "";
      if (!runId) return;
      upsert(runId, {
        source: "task",
        agent: r.selectedAgent,
        title: r.task?.title || "Structured task",
        subtitle: r.routingReason,
        taskStatus: r.status,
        error: r.error,
        exitCode: r.code ?? null,
      });
    });

    const offAgents = window.exec.onAgentsStatus((evt: AgentStatusEvent) => {
      const wired = normalizeAgent(evt.agent);
      if (wired)
        setBridgeLive((prev) => {
          const next = { ...prev };
          if (evt.state === "running") next[wired] = "running";
          else delete next[wired];
          return next;
        });
      const runId = evt.runId || "";
      if (!runId) return;
      upsert(runId, {
        source: "dispatch",
        agent: normalizeAgent(evt.agent),
        title: "Freeform dispatch",
        subtitle: evt.reason,
        dispatchState: evt.state,
        error: evt.error ?? null,
        exitCode: typeof evt.code === "number" ? evt.code : null,
      });
    });

    const offData = window.exec.onRunData((e: { runId: string; stream: string; chunk: string }) => {
      const { runId, stream, chunk } = e;
      if (!runId || !chunk || (stream !== "stdout" && stream !== "stderr")) return;
      setRows((prev) => {
        const next = new Map(prev);
        const cur =
          next.get(runId) ||
          ({
            runId,
            source: "dispatch",
            agent: null,
            title: "Agent run",
            transcript: "",
            truncated: false,
            exitCode: null,
            error: null,
            updatedAt: Date.now(),
          } as AgentLiveRow);
        const appended = appendLimited(cur.transcript, chunk);
        next.set(runId, {
          ...cur,
          transcript: appended.text,
          truncated: cur.truncated || appended.truncatedFlag,
          updatedAt: Date.now(),
        });
        return pruneRows(next);
      });
    });

    const offEnd = window.exec.onRunEnd((e: { runId: string; code: number; error?: string }) => {
      const { runId, code, error } = e;
      if (!runId) return;
      const tail =
        `${error ? `${error}\n` : ""}— exit ${typeof code === "number" ? code : "?"} —\n`;
      setRows((prev) => {
        const next = new Map(prev);
        const cur =
          next.get(runId) ||
          ({
            runId,
            source: "dispatch",
            agent: null,
            title: "Agent run",
            transcript: "",
            truncated: false,
            exitCode: null,
            error: null,
            updatedAt: Date.now(),
          } as AgentLiveRow);
        const appended = appendLimited(cur.transcript, tail);
        next.set(runId, {
          ...cur,
          transcript: appended.text,
          truncated: cur.truncated || appended.truncatedFlag,
          exitCode: typeof code === "number" ? code : null,
          error: error || cur.error,
          updatedAt: Date.now(),
        });
        return pruneRows(next);
      });
    });

    return () => {
      offTask();
      offAgents();
      offData();
      offEnd();
    };
  }, [upsert]);

  const sorted = useMemo(
    () => [...rows.values()].sort((a, b) => b.updatedAt - a.updatedAt),
    [rows],
  );

  const filtered = useMemo(
    () => sorted.filter((r) => filter === "all" || r.agent === filter),
    [sorted, filter],
  );

  useEffect(() => {
    if (filtered.length === 0) {
      setSelectedRunId(null);
      return;
    }
    if (!selectedRunId || !filtered.some((r) => r.runId === selectedRunId)) {
      setSelectedRunId(filtered[0].runId);
    }
  }, [filtered, selectedRunId]);

  const detail = selectedRunId ? rows.get(selectedRunId) : null;

  const runningCount = sorted.filter(rowRunning).length;

  return (
    <section
      className={`relative rounded-[18px] backdrop-blur-2xl ring-1 ring-white/10 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col ${className}`}
    >
      <div className="absolute inset-0 -z-10 bg-[#070709]/97 pointer-events-none" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-white/[0.04] via-transparent to-transparent pointer-events-none" />
      <div className="relative border-b border-white/[0.06] px-3 py-2 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-col gap-1 min-w-0 shrink">
            <span className="text-[14px] sm:text-[15px] font-semibold tracking-tight text-white/[0.92] leading-tight truncate">
              Live agents
            </span>
            <span className="text-[10px] text-white/38 truncate">
              {runningCount > 0 ? `${runningCount} active` : "Idle"}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5 ml-auto">
          {FILTER_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`text-[10.5px] px-2.5 h-[24px] rounded-md border transition-colors ${
                filter === key
                  ? "bg-emerald-500/25 border-emerald-400/40 text-emerald-100"
                  : "bg-white/[0.04] border-white/[0.08] text-white/70 hover:bg-white/[0.07]"
              }`}
            >
              {key === "all" ? "All" : "Claude"}
            </button>
          ))}
          </div>
        </div>
        <AgentUsageStrip />
      </div>

      <div className="relative flex max-h-[min(52vh,480px)] min-h-[220px] flex-1 flex-row divide-x divide-white/[0.06]">
        {/* Agents: hub + run list */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          <div className="shrink-0 px-3 py-1 border-b border-white/[0.05] bg-[#050508]/60">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/40">
              Agents
            </span>
          </div>
          <div className="shrink-0 px-2 py-2 bg-[#050508]/95 border-b border-white/[0.05]">
            <AgentsConnectionGraph cli={bridgeCli} live={bridgeLive} variant="compact" />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {filtered.length === 0 ? null : (
              <ul className="py-1">
                {filtered.map((r) => {
                  const tone = statusTone(r);
                  const dot =
                    tone === "run"
                      ? "bg-emerald-400 animate-pulse"
                      : tone === "ok"
                        ? "bg-sky-400/90"
                        : tone === "err"
                          ? "bg-rose-400/95"
                          : "bg-white/25";
                  return (
                    <li key={r.runId}>
                      <button
                        type="button"
                        onClick={() => setSelectedRunId(r.runId)}
                        className={`w-full text-left px-3 py-2 border-b border-white/[0.04] hover:bg-white/[0.04] flex flex-col gap-0.5 ${
                          selectedRunId === r.runId ? "bg-white/[0.06]" : ""
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${dot}`} />
                          <span className="text-[12px] text-white/90 truncate">
                            {r.agent ? r.agent[0].toUpperCase() + r.agent.slice(1) : "?"}{" "}
                            <span className="text-white/40">·</span> {r.title}
                          </span>
                        </span>
                        <span className="text-[10px] text-white/45 truncate pl-5">
                          {statusLabel(r)}
                          {r.subtitle ? ` · ${r.subtitle}` : ""}
                        </span>
                        {r.agent === "cursor" && rowRunning(r) && (
                          <span className="text-[10px] text-amber-200/70 pl-5">Opens Cursor — no CLI transcript</span>
                        )}
                        {r.error && tone === "err" && (
                          <span className="text-[10px] text-rose-200/80 pl-5 truncate">{r.error}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Selected run output */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0 bg-black/20">
          <div className="shrink-0 px-3 py-1 border-b border-white/[0.05] bg-[#050508]/45">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/40">
              Run
            </span>
          </div>
          {!detail ? (
            <div className="flex-1 flex items-center justify-center text-[11px] text-white/40 px-4 text-center">
              Select a run
            </div>
          ) : (
            <div className="flex flex-col flex-1 min-h-0 min-w-0">
              <div className="shrink-0 px-3 py-2 border-b border-white/[0.05] flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-white/50">
                <span>
                  Agent:{" "}
                  <span className="text-white/80">{detail.agent || "unknown"}</span>
                </span>
                <span>
                  Status:{" "}
                  <span className="text-white/80">{statusLabel(detail)}</span>
                </span>
                {detail.exitCode !== null && detail.exitCode !== undefined && (
                  <span>
                    Exit: <span className="text-white/80">{detail.exitCode}</span>
                  </span>
                )}
                {detail.truncated && (
                  <span className="text-amber-200/80">Older output truncated (size cap)</span>
                )}
              </div>
              <pre className="flex-1 min-h-0 m-0 p-3 text-[11px] leading-snug whitespace-pre-wrap break-words mono text-white/[0.82] overflow-y-auto">
                {detail.transcript.trim() ? (
                  detail.transcript
                ) : detail.agent === "cursor" ? (
                  <span className="text-white/45">
                    No CLI stream for Cursor. Follow status in the list; prompt is pasted into Cursor.
                  </span>
                ) : rowRunning(detail) ? (
                  <span className="text-white/45">Waiting for output…</span>
                ) : (
                  <span className="text-white/45">No output captured for this run.</span>
                )}
              </pre>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
