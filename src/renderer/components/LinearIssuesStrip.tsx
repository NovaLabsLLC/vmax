import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { Bubble } from "./TalkBack";
import {
  fetchAllMyLinearIssues,
  type LinearIssueRow,
  type FetchLinearIssuesResult,
} from "../utils/fetchLinearIssues";
import { formatLinearIssueAsWorkspaceTask } from "../utils/formatLinearTaskPayload";
import { fetchLinearIssueAgentBrief } from "../utils/linearAgentBrief";

type Props = {
  say: (text: string, tone?: Bubble["tone"]) => void;
  onFillTask: (text: string) => void;
};

type WsBucket = { key: string; label: string; count: number };

/**
 * Lists every **open** Linear issue assigned to the viewer (all connected
 * workspaces). Backed by GET /v1/linear/issues?fetch_all=true (paginated server-side).
 */
export default function LinearIssuesStrip({ say, onFillTask }: Props) {
  const [rows, setRows] = useState<LinearIssueRow[]>([]);
  const [meta, setMeta] = useState<FetchLinearIssuesResult["workspaces"]>([]);
  const [errs, setErrs] = useState<FetchLinearIssuesResult["errors"]>([]);
  /** True until first in-flight completes — avoids flash before mount effect runs. */
  const [loading, setLoading] = useState(true);
  /** Limit list to issues from one connected Linear workspace (`meta` ids). */
  const [workspaceFilter, setWorkspaceFilter] = useState<"all" | string>("all");
  /** Row key while `/agent-brief` runs — disables duplicate clicks across the strip. */
  const [busyEnrichRow, setBusyEnrichRow] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setErrs([]);
    try {
      const data = await fetchAllMyLinearIssues();
      setRows(data.issues || []);
      setMeta(data.workspaces || []);
      setErrs(data.errors || []);
      if (data.errors?.length && !data.count) {
        say(
          data.errors.map((e) => `${e.name}: ${e.error}`).join(" — ") ||
            "Couldn't load Linear.",
          "warn",
        );
        return;
      }
      say(
        data.count
          ? `Loaded ${data.count} open Linear issue${data.count === 1 ? "" : "s"} across your workspace(s).`
          : "No open issues assigned to you in Linear.",
        data.count ? "success" : "info",
      );
    } catch (e) {
      setRows([]);
      setMeta([]);
      setErrs([]);
      say(
        String((e as Error)?.message || e).includes("No Linear")
          ? "Connect Linear under Settings, then try again."
          : `Linear fetch failed: ${(e as Error).message}`,
        "warn",
      );
    } finally {
      setLoading(false);
    }
  }, [say]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  /** Per-workspace counts for filter chips — backend `meta` when multi-workspace, else derived from rows. */
  const filterBuckets: WsBucket[] = useMemo(() => {
    if (meta.length > 1) {
      return meta.map((w) => ({
        key: w.id,
        label: (w.name || "").trim() || w.id,
        count: w.count ?? 0,
      }));
    }
    if (meta.length === 1) {
      return [
        {
          key: meta[0].id,
          label: (meta[0].name || "").trim() || meta[0].id,
          count: meta[0].count ?? 0,
        },
      ];
    }
    const tally = new Map<string, WsBucket>();
    for (const r of rows) {
      const key = String(r._workspace_id || "_");
      const label = ((r._workspace_name || "").trim() || key) as string;
      const prev = tally.get(key);
      tally.set(key, {
        key,
        label,
        count: (prev?.count ?? 0) + 1,
      });
    }
    return [...tally.values()];
  }, [meta, rows]);

  useEffect(() => {
    if (workspaceFilter === "all") return;
    const ok = filterBuckets.some((b) => b.key === workspaceFilter);
    if (!ok) setWorkspaceFilter("all");
  }, [workspaceFilter, filterBuckets]);

  const filteredRows = useMemo(() => {
    if (workspaceFilter === "all") return rows;
    return rows.filter((r) => String(r._workspace_id || "") === workspaceFilter);
  }, [rows, workspaceFilter]);

  const showFilters = filterBuckets.length > 1;

  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-3 space-y-2 w-full">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-wide text-white/45">
          Linear
        </span>
        <span className="text-[11px] text-white/42 flex-1 min-w-[10rem]">
          Loads when you open Workspace. All orgs you connected in Settings.
        </span>
        <button
          type="button"
          disabled={loading}
          onClick={() => void loadAll()}
          className="shrink-0 text-[11px] px-3 h-[26px] rounded-md bg-violet-500/20 hover:bg-violet-500/30 border border-violet-400/35 text-violet-100 disabled:opacity-45"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {errs.length > 0 ? (
        <div className="text-[10.5px] text-amber-200/90 space-y-0.5">
          {errs.map((e) => (
            <div key={e.id}>
              <span className="font-medium">{e.name}</span>: {e.error}
            </div>
          ))}
        </div>
      ) : null}

      {showFilters ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/40 shrink-0">
            Filter
          </span>
          <div className="flex flex-wrap gap-1.5">
            <FilterChip
              label={`All (${rows.length})`}
              active={workspaceFilter === "all"}
              onClick={() => setWorkspaceFilter("all")}
            />
            {filterBuckets.map((b) => (
              <FilterChip
                key={b.key}
                label={`${b.label} (${b.count})`}
                active={workspaceFilter === b.key}
                onClick={() => setWorkspaceFilter(b.key)}
              />
            ))}
          </div>
        </div>
      ) : null}

      {loading && rows.length === 0 ? (
        <p className="text-[11px] text-white/42 py-2">Loading issues from Linear…</p>
      ) : null}

      {rows.length > 0 && filteredRows.length > 0 ? (
        <div className="max-h-[min(50vh,28rem)] overflow-y-auto rounded-lg border border-white/[0.06] bg-black/20 divide-y divide-white/[0.05]">
          {filteredRows.map((row, idx) => {
            const id = row.identifier || "?";
            const title = (row.title || "(no title)").trim();
            const st = (row.state?.name || "").trim();
            const ws = (row._workspace_name || "").trim();
            const key = `${row._workspace_id || "x"}-${id}-${idx}`;
            return (
              <button
                key={key}
                type="button"
                disabled={!!busyEnrichRow}
                className={`w-full text-left px-2.5 py-1.5 hover:bg-white/[0.04] transition-colors disabled:opacity-40 disabled:pointer-events-none ${
                  busyEnrichRow === key ? "bg-white/[0.03]" : ""
                }`}
                onClick={() => void (async () => {
                  const base = formatLinearIssueAsWorkspaceTask(row);
                  const ident = row.identifier?.trim();
                  if (!ident || ident === "?") {
                    onFillTask(base);
                    say("This issue has no Linear identifier.", "warn");
                    return;
                  }

                  setBusyEnrichRow(key);
                  say(`Synthesizing agent brief for ${ident}…`, "info");
                  try {
                    const out = await fetchLinearIssueAgentBrief(ident, base);
                    onFillTask(out.task_text);
                    if (out.linear_updated)
                      say(`Loaded brief for ${ident} and synced to Linear description.`, "success");
                    else if (out.linear_error)
                      say(
                        `${ident}: brief ready; Linear wasn't updated (${out.linear_error}).`,
                        "warn",
                      );
                    else say(`Loaded agent-ready brief for ${ident}.`, "success");
                  } catch (err) {
                    onFillTask(base);
                    say(
                      `Used raw Linear bundle for ${ident} (${String((err as Error)?.message || err)}).`,
                      "warn",
                    );
                  } finally {
                    setBusyEnrichRow(null);
                  }
                })()}
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0">
                  <span className="mono text-[11px] text-violet-200/95 shrink-0">{id}</span>
                  <span className="text-[11.5px] text-white/88 flex-1 min-w-0">{title}</span>
                </div>
                <div className="text-[10px] text-white/40 mt-0.5">
                  {st}
                  {ws ? ` · ${ws}` : ""}
                  {row.team?.key ? ` · ${row.team.key}` : ""}
                </div>
              </button>
            );
          })}
        </div>
      ) : !loading && rows.length > 0 && filteredRows.length === 0 ? (
        <p className="text-[11px] text-white/38">No issues match this workspace filter.</p>
      ) : null}

      {!loading && rows.length === 0 && errs.length === 0 ? (
        <p className="text-[11px] text-white/38">No open issues assigned to you in Linear.</p>
      ) : null}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[11px] px-2.5 py-1 rounded-full font-medium transition-colors border ${
        active
          ? "bg-violet-500/35 text-violet-50 border-violet-400/50"
          : "bg-white/[0.04] text-white/70 border-white/[0.1] hover:bg-white/[0.08] hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}
