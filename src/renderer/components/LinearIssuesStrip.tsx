import React, { useCallback, useState } from "react";
import type { Bubble } from "./TalkBack";
import {
  fetchAllMyLinearIssues,
  type LinearIssueRow,
  type FetchLinearIssuesResult,
} from "../utils/fetchLinearIssues";
import { formatLinearIssueAsWorkspaceTask } from "../utils/formatLinearTaskPayload";

type Props = {
  say: (text: string, tone?: Bubble["tone"]) => void;
  onFillTask: (text: string) => void;
};

/**
 * Lists every **open** Linear issue assigned to the viewer (all connected
 * workspaces). Backed by GET /v1/linear/issues?fetch_all=true (paginated server-side).
 */
export default function LinearIssuesStrip({ say, onFillTask }: Props) {
  const [rows, setRows] = useState<LinearIssueRow[]>([]);
  const [meta, setMeta] = useState<FetchLinearIssuesResult["workspaces"]>([]);
  const [errs, setErrs] = useState<FetchLinearIssuesResult["errors"]>([]);
  const [loading, setLoading] = useState(false);

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

  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-3 space-y-2 w-full">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-wide text-white/45">
          Linear
        </span>
        <span className="text-[11px] text-white/42 flex-1 min-w-[10rem]">
          Open issues assigned to you (all orgs you connected in Settings).
        </span>
        <button
          type="button"
          disabled={loading}
          onClick={() => void loadAll()}
          className="shrink-0 text-[11px] px-3 h-[26px] rounded-md bg-violet-500/20 hover:bg-violet-500/30 border border-violet-400/35 text-violet-100 disabled:opacity-45"
        >
          {loading ? "Fetching…" : "Fetch all issues"}
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

      {meta.length > 1 ? (
        <div className="text-[10px] text-white/38">
          {meta.map((w) => `${w.name}: ${w.count}`).join(" · ")}
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="max-h-[min(50vh,28rem)] overflow-y-auto rounded-lg border border-white/[0.06] bg-black/20 divide-y divide-white/[0.05]">
          {rows.map((row, idx) => {
            const id = row.identifier || "?";
            const title = (row.title || "(no title)").trim();
            const st = (row.state?.name || "").trim();
            const ws = (row._workspace_name || "").trim();
            const key = `${row._workspace_id || "x"}-${id}-${idx}`;
            return (
              <button
                key={key}
                type="button"
                className="w-full text-left px-2.5 py-1.5 hover:bg-white/[0.04] transition-colors"
                onClick={() => {
                  onFillTask(formatLinearIssueAsWorkspaceTask(row));
                  say(`Loaded full Linear context for ${id}.`, "info");
                }}
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
      ) : !loading && rows.length === 0 && errs.length === 0 ? (
        <p className="text-[11px] text-white/38">Press fetch to load from Linear.</p>
      ) : null}
    </div>
  );
}
