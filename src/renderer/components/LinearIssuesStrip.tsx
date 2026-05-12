import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Bubble } from "./TalkBack";
import {
  fetchAllMyLinearIssues,
  type LinearIssueRow,
  type FetchLinearIssuesResult,
} from "../utils/fetchLinearIssues";
import { formatLinearIssueAsWorkspaceTask } from "../utils/formatLinearTaskPayload";
import { fetchLinearIssueAgentBrief } from "../utils/linearAgentBrief";
import { listLinearWorkspaces, type LinearWorkspace } from "../utils/linearWorkspacesApi";
import { createLinearIssue, fetchLinearTeams, type LinearTeamOption } from "../utils/linearIssueCreate";
import { patchLinearIssue, moveLinearIssueToDone } from "../utils/linearIssuePatch";
import { encodeImageFileAsJpegBase64 } from "../utils/imageToJpegBase64";
import { draftLinearIssueFromImage } from "../utils/linearIssueDraftFromImage";

type Props = {
  say: (text: string, tone?: Bubble["tone"]) => void;
  /** Logs from Linear listing — shown in Workspace terminal (stdout/stderr), not bubbles. */
  onTerminalAppend: (text: string, stream: "stdout" | "stderr") => void;
  onFillTask: (text: string) => void;
  /** Latest Linear shorthand id linked from the clicked row (`EXE-28`), or null. */
  onLinearIssueFocus?: (issueIdentifier: string | null) => void;
  /**
   * After `/agent-brief` succeeds — typically open Cursor with the enriched task text (Workspace wires this).
   */
  onBriefReadySendToCursor?: (enrichedTaskText: string) => void | Promise<void>;
};

type WsBucket = { key: string; label: string; count: number };

const EXPAND_LS_KEY = "linear-issues-strip-expanded";

function readStoredExpanded(): boolean {
  try {
    const v = localStorage.getItem(EXPAND_LS_KEY);
    if (v === "0") return false;
    if (v === "1") return true;
  } catch {
    /* ignore */
  }
  return true;
}

function writeStoredExpanded(on: boolean) {
  try {
    localStorage.setItem(EXPAND_LS_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/** Linear ISO timestamps often include time; `<input type="date">` needs YYYY-MM-DD. */
function linearDueToInputValue(iso?: string | null): string {
  if (!iso) return "";
  const s = String(iso).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
}

/**
 * Lists every **open** Linear issue assigned to the viewer (all connected
 * workspaces). Backed by GET /v1/linear/issues?fetch_all=true (paginated server-side).
 */
export default function LinearIssuesStrip({
  say,
  onTerminalAppend,
  onFillTask,
  onLinearIssueFocus,
  onBriefReadySendToCursor,
}: Props) {
  const [rows, setRows] = useState<LinearIssueRow[]>([]);
  const [meta, setMeta] = useState<FetchLinearIssuesResult["workspaces"]>([]);
  const [errs, setErrs] = useState<FetchLinearIssuesResult["errors"]>([]);
  /** True until first in-flight completes — avoids flash before mount effect runs. */
  const [loading, setLoading] = useState(true);
  /** Limit list to issues from one connected Linear workspace (`meta` ids). */
  const [workspaceFilter, setWorkspaceFilter] = useState<"all" | string>("all");
  /** Row key while `/agent-brief` runs — disables duplicate clicks across the strip. */
  const [busyEnrichRow, setBusyEnrichRow] = useState<string | null>(null);
  /** Row key while marking an issue done via Linear API. */
  const [markDoneKey, setMarkDoneKey] = useState<string | null>(null);
  /** Inline create form */
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<LinearWorkspace[]>([]);
  const [createWorkspaceId, setCreateWorkspaceId] = useState<string | null>(null);
  const [teams, setTeams] = useState<LinearTeamOption[]>([]);
  const [createTeamId, setCreateTeamId] = useState("");
  const [createTitle, setCreateTitle] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [assignToMe, setAssignToMe] = useState(true);
  const [imageDraftBusy, setImageDraftBusy] = useState(false);
  /** Expanded = full strip; collapsed = slim header row only. */
  const [expanded, setExpanded] = useState<boolean>(() =>
    typeof window !== "undefined" ? readStoredExpanded() : true,
  );
  /** Monotonic millis for rerenders while enriching (interval updates). */
  const [, setBriefTick] = useState(0);
  /** Wall/perf timestamp when agent-brief request started (`null` when idle). */
  const briefStartRef = useRef<number | null>(null);
  const createTitleInputRef = useRef<HTMLInputElement | null>(null);
  const createImageFileRef = useRef<HTMLInputElement | null>(null);
  /** Ignores overlapping fetchLinearTeams responses when workspace picker changes quickly. */
  const teamsFetchGenRef = useRef(0);
  /** Edit existing issue (`null` when dialog closed). */
  const [editTarget, setEditTarget] = useState<LinearIssueRow | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editDue, setEditDue] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const editTitleInputRef = useRef<HTMLInputElement | null>(null);

  const closeCreateModal = useCallback(() => {
    if (createBusy || imageDraftBusy) return;
    setCreateOpen(false);
  }, [createBusy, imageDraftBusy]);

  const closeEditModal = useCallback(() => {
    if (editBusy) return;
    setEditTarget(null);
    setEditError(null);
  }, [editBusy]);

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      writeStoredExpanded(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!busyEnrichRow) return;
    const id = window.setInterval(() => setBriefTick((n) => n + 1), 100);
    return () => window.clearInterval(id);
  }, [busyEnrichRow]);

  const briefElapsedSec =
    busyEnrichRow != null && briefStartRef.current != null
      ? (((typeof performance !== "undefined" ? performance.now() : Date.now()) -
          briefStartRef.current) /
        1000)
      : 0;

  const loadAll = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    setLoading(true);
    setErrs([]);
    try {
      const data = await fetchAllMyLinearIssues();
      setRows(data.issues || []);
      setMeta(data.workspaces || []);
      setErrs(data.errors || []);
      if (data.errors?.length && !data.count) {
        onTerminalAppend(
          data.errors.map((e) => `${e.name}: ${e.error}`).join(" — ") ||
            "[linear] Couldn't load issues.",
          "stderr",
        );
        return;
      }
      if (!silent) {
        const line =
          data.count > 0
            ? `[linear] Loaded ${data.count} open issue${data.count === 1 ? "" : "s"} across your workspace(s).`
            : "[linear] No open issues assigned to you in Linear.";
        onTerminalAppend(line, "stdout");
      }
    } catch (e) {
      setRows([]);
      setMeta([]);
      setErrs([]);
      const raw = String((e as Error)?.message || e);
      const line = raw.includes("No Linear")
        ? "[linear] Connect Linear under Settings, then try again."
        : `[linear] Fetch failed: ${(e as Error).message}`;
      onTerminalAppend(line, "stderr");
    } finally {
      setLoading(false);
    }
  }, [onTerminalAppend]);

  const markRowDone = useCallback(
    async (rowKey: string, identifier: string) => {
      const ident = String(identifier || "").trim();
      if (!ident || ident === "?") {
        say("This issue has no Linear identifier.", "warn");
        return;
      }
      setMarkDoneKey(rowKey);
      try {
        await moveLinearIssueToDone(ident);
        say(`Moved ${ident} to Done in Linear.`, "success");
        await loadAll({ silent: true });
      } catch (e) {
        say(String((e as Error)?.message || e), "warn");
      } finally {
        setMarkDoneKey(null);
      }
    },
    [say, loadAll],
  );

  const beginEditIssue = useCallback((row: LinearIssueRow) => {
    setEditError(null);
    setEditTitle((row.title || "").trim());
    setEditDesc(`${row.description ?? ""}`.trim());
    setEditDue(linearDueToInputValue(row.dueDate));
    setEditTarget(row);
  }, []);

  const submitEditIssue = useCallback(async () => {
    const row = editTarget;
    const identRaw = `${row?.identifier ?? ""}`.trim();
    if (!row || !identRaw || identRaw === "?") {
      say("This issue can't be edited (missing Linear identifier).", "warn");
      return;
    }
    const title = editTitle.trim();
    if (!title) {
      setEditError("Title is required.");
      say("Linear issues need a non-empty title.", "warn");
      return;
    }
    setEditBusy(true);
    setEditError(null);
    try {
      const initialDue = linearDueToInputValue(row.dueDate);
      const dueTrim = editDue.trim();
      const patch: Parameters<typeof patchLinearIssue>[1] = {
        title,
        description: editDesc.trim() || "",
      };
      if (dueTrim !== initialDue) {
        patch.due_date = dueTrim ? dueTrim : null;
      }
      await patchLinearIssue(identRaw, patch);
      say(`Updated ${identRaw} in Linear.`, "success");
      await loadAll({ silent: true });
      setEditTarget(null);
      setEditError(null);
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      setEditError(msg);
      say(msg, "warn");
    } finally {
      setEditBusy(false);
    }
  }, [editDesc, editDue, editTarget, editTitle, loadAll, say]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const loadTeamsForCreate = useCallback(async (workspaceId: string | null) => {
    const gen = ++teamsFetchGenRef.current;
    setCreateError(null);
    try {
      const out = await fetchLinearTeams(workspaceId || undefined);
      if (gen !== teamsFetchGenRef.current) return;
      setTeams(out.teams || []);
      const first = out.teams?.[0];
      setCreateTeamId((first?.id || first?.key || "").trim());
    } catch (e) {
      if (gen !== teamsFetchGenRef.current) return;
      setTeams([]);
      setCreateTeamId("");
      setCreateError(String((e as Error)?.message || e));
    }
  }, []);

  useEffect(() => {
    if (!createOpen) return;
    let cancelled = false;
    void (async () => {
      setCreateError(null);
      try {
        const list = await listLinearWorkspaces();
        if (cancelled) return;
        setWorkspaces(list);
        const wid = list.length === 0 ? null : list[0].id;
        setCreateWorkspaceId(wid);
        await loadTeamsForCreate(wid);
      } catch (e) {
        if (!cancelled) {
          setWorkspaces([]);
          setCreateWorkspaceId(null);
          setCreateError(String((e as Error)?.message || e));
          await loadTeamsForCreate(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [createOpen, loadTeamsForCreate]);

  useEffect(() => {
    if (!createOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeCreateModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [createOpen, closeCreateModal]);

  useEffect(() => {
    if (!createOpen) return;
    const id = window.setTimeout(() => createTitleInputRef.current?.focus(), 80);
    return () => window.clearTimeout(id);
  }, [createOpen]);

  useEffect(() => {
    if (!editTarget) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeEditModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editTarget, closeEditModal]);

  useEffect(() => {
    if (!editTarget) return;
    const id = window.setTimeout(() => editTitleInputRef.current?.focus(), 80);
    return () => window.clearTimeout(id);
  }, [editTarget]);

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

  const submitCreate = useCallback(async () => {
    const title = createTitle.trim();
    const teamPick = createTeamId.trim();
    if (!title || !teamPick) {
      say("Add a title and pick a team.", "warn");
      return;
    }
    setCreateBusy(true);
    setCreateError(null);
    let workspacePayload: string | undefined;
    if (workspaces.length > 1) workspacePayload = createWorkspaceId || undefined;
    else if (workspaces.length === 1) workspacePayload = workspaces[0].id;
    try {
      const out = await createLinearIssue({
        title,
        description: createDesc.trim() || undefined,
        team_id: teamPick,
        workspace_id: workspacePayload,
        assign_to_me: assignToMe,
      });
      const issue = out.issue || {};
      const ident = typeof issue.identifier === "string" ? issue.identifier.trim() : "";
      const url = typeof issue.url === "string" ? issue.url.trim() : "";
      setCreateTitle("");
      setCreateDesc("");
      say(
        ident
          ? `Created Linear issue ${ident}${url ? `. ${url}` : ""}`
          : `Created issue in Linear${url ? `: ${url}` : ""}`,
        "success",
      );
      await loadAll();
      setCreateOpen(false);
    } catch (e) {
      setCreateError(String((e as Error)?.message || e));
      say(String((e as Error)?.message || e), "warn");
    } finally {
      setCreateBusy(false);
    }
  }, [
    assignToMe,
    createDesc,
    createTeamId,
    createTitle,
    createWorkspaceId,
    loadAll,
    say,
    workspaces,
  ]);

  const triggerImageDraftPicker = useCallback(() => {
    createImageFileRef.current?.click();
  }, []);

  const onCreateImageDraftChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const inputEl = e.currentTarget;
      const file = inputEl.files?.[0];
      inputEl.value = "";
      if (!file || createBusy || imageDraftBusy) return;
      const mimeOk = /^image\/(jpeg|png)$/i.test(file.type);
      const nameOk = /\.(jpe?g|png)$/i.test(file.name);
      if (!mimeOk && !nameOk) {
        say("Use a JPEG or PNG image.", "warn");
        return;
      }
      setImageDraftBusy(true);
      setCreateError(null);
      try {
        const b64 = await encodeImageFileAsJpegBase64(file);
        const out = await draftLinearIssueFromImage(b64);
        setCreateTitle((out.title || "").slice(0, 512));
        setCreateDesc((out.description || "").slice(0, 50000));
        say("Filled title and description from the image. Edit before creating.", "success");
      } catch (err) {
        const msg = String((err as Error)?.message || err);
        setCreateError(msg);
        say(msg, "warn");
      } finally {
        setImageDraftBusy(false);
      }
    },
    [createBusy, imageDraftBusy, say],
  );

  const showFilters = filterBuckets.length > 1;

  const createModal =
    createOpen &&
    typeof document !== "undefined" &&
    createPortal(
      <div
        className="fixed inset-0 z-[1000] flex items-center justify-center p-4 sm:p-6"
        role="presentation"
      >
        <button
          type="button"
          aria-label="Close"
          disabled={createBusy || imageDraftBusy}
          className={`absolute inset-0 bg-black/[0.55] backdrop-blur-[2px] ${createBusy || imageDraftBusy ? "cursor-default" : "cursor-pointer"}`}
          onClick={() => closeCreateModal()}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="linear-add-task-heading"
          className="relative z-[1001] w-full max-w-lg max-h-[min(90vh,40rem)] overflow-y-auto rounded-2xl border border-white/[0.12]
                     bg-[#0e0e12]/95 shadow-[0_24px_80px_-24px_rgba(0,0,0,0.85)] p-4 sm:p-5 space-y-3"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2
                id="linear-add-task-heading"
                className="text-[13px] font-semibold tracking-tight text-white/92"
              >
                Add Linear task
              </h2>
              <p className="text-[11px] text-white/45 mt-0.5 leading-snug">
                Creates an issue via your Settings keys and team. ESC or backdrop to dismiss.
              </p>
            </div>
            <button
              type="button"
              disabled={createBusy || imageDraftBusy}
              aria-label="Close dialog"
              onClick={() => closeCreateModal()}
              className="shrink-0 rounded-lg border border-white/[0.12] bg-white/[0.06] hover:bg-white/[0.11]
                         text-white/75 hover:text-white w-8 h-8 flex items-center justify-center text-[16px]
                         leading-none disabled:opacity-40 disabled:pointer-events-none"
            >
              ×
            </button>
          </div>

          {createError ? (
            <p className="text-[11px] text-rose-200/95 leading-snug">{createError}</p>
          ) : null}
          {workspaces.length > 1 ? (
            <label className="block space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-white/40">
                Linear workspace
              </span>
              <select
                value={createWorkspaceId || workspaces[0]?.id || ""}
                onChange={(e) => {
                  const id = e.target.value || null;
                  setCreateWorkspaceId(id);
                  void loadTeamsForCreate(id);
                }}
                disabled={createBusy || imageDraftBusy}
                className="w-full text-[11.5px] rounded-md bg-white/[0.06] border border-white/[0.12] px-2 py-1.5 text-white/88"
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {(w.label || w.workspace_name || w.workspace_url_key || w.id).trim() || w.id}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-white/40">
              Title
            </span>
            <input
              ref={createTitleInputRef}
              type="text"
              value={createTitle}
              onChange={(e) => setCreateTitle(e.target.value)}
              placeholder="Issue title"
              disabled={createBusy || imageDraftBusy}
              maxLength={512}
              className="w-full text-[11.5px] rounded-md bg-white/[0.06] border border-white/[0.12] px-2 py-1.5 text-white placeholder:text-white/35"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={createImageFileRef}
              type="file"
              accept="image/jpeg,image/png,.jpg,.jpeg,.png"
              hidden
              onChange={(e) => void onCreateImageDraftChange(e)}
            />
            <button
              type="button"
              disabled={createBusy || imageDraftBusy}
              title="JPEG or PNG: extract title and description with the vision model"
              onClick={() => triggerImageDraftPicker()}
              className="text-[11px] px-3 h-[28px] rounded-md bg-violet-500/20 hover:bg-violet-500/30 border border-violet-400/35 text-violet-100
                         disabled:opacity-45 disabled:pointer-events-none transition-colors"
            >
              {imageDraftBusy ? "Reading image…" : "Fill from photo"}
            </button>
            <span className="text-[10px] text-white/38 leading-snug">
              Uses backend vision (OpenAI / Anthropic). Does not create the issue until you tap Create.
            </span>
          </div>
          <label className="block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-white/40">
              Description{" "}
              <span className="font-normal text-white/32">optional</span>
            </span>
            <textarea
              value={createDesc}
              onChange={(e) => setCreateDesc(e.target.value)}
              placeholder="More context…"
              disabled={createBusy || imageDraftBusy}
              rows={3}
              className="w-full resize-y min-h-[3.25rem] text-[11.5px] rounded-md bg-white/[0.06] border border-white/[0.12] px-2 py-1.5 text-white placeholder:text-white/35 mono"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-white/40">
              Team
            </span>
            <select
              value={createTeamId}
              onChange={(e) => setCreateTeamId(e.target.value)}
              disabled={createBusy || imageDraftBusy || teams.length === 0}
              className="w-full text-[11.5px] rounded-md bg-white/[0.06] border border-white/[0.12] px-2 py-1.5 text-white/88 mono"
            >
              {teams.length === 0 ? (
                <option value="">Loading teams…</option>
              ) : (
                teams.map((t) => {
                  const val = `${t.id || t.key || ""}`.trim();
                  const ky = `${t.key || ""}`.trim();
                  const nm = `${t.name || ""}`.trim();
                  const label =
                    ky && nm ? `${ky} — ${nm}` : ky || nm || val || "?";
                  return (
                    <option key={val || label} value={val}>
                      {label}
                    </option>
                  );
                })
              )}
            </select>
          </label>
          <label className="flex items-center gap-2 text-[11px] text-white/75 cursor-pointer select-none">
            <input
              type="checkbox"
              className="rounded border-white/25 bg-transparent"
              checked={assignToMe}
              disabled={createBusy || imageDraftBusy}
              onChange={(e) => setAssignToMe(e.target.checked)}
            />
            Assign to me
          </label>
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-white/[0.06]">
            <button
              type="button"
              disabled={
                createBusy ||
                imageDraftBusy ||
                !createTitle.trim() ||
                !(`${createTeamId || ""}`.trim()) ||
                teams.length === 0
              }
              onClick={() => void submitCreate()}
              className="text-[11px] px-3 h-[28px] rounded-md bg-emerald-500/25 hover:bg-emerald-500/35 border border-emerald-400/35 text-emerald-100 disabled:opacity-45 disabled:pointer-events-none"
            >
              {createBusy ? "Creating…" : "Create in Linear"}
            </button>
            <button
              type="button"
              disabled={createBusy || imageDraftBusy}
              onClick={() => closeCreateModal()}
              className="text-[11px] px-3 h-[28px] rounded-md bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.1] text-white/75 disabled:opacity-35"
            >
              Cancel
            </button>
          </div>
          <p className="text-[10px] text-white/38">Uses Linear keys from Settings. Backend must be running.</p>
        </div>
      </div>,
      document.body,
    );

  const editModal =
    editTarget &&
    typeof document !== "undefined" &&
    createPortal(
      <div
        className="fixed inset-0 z-[1000] flex items-center justify-center p-4 sm:p-6"
        role="presentation"
      >
        <button
          type="button"
          aria-label="Close edit dialog backdrop"
          disabled={editBusy}
          className={`absolute inset-0 bg-black/[0.55] backdrop-blur-[2px] ${editBusy ? "cursor-default" : "cursor-pointer"}`}
          onClick={() => closeEditModal()}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="linear-edit-issue-heading"
          className="relative z-[1001] w-full max-w-lg max-h-[min(90vh,40rem)] overflow-y-auto rounded-2xl border border-white/[0.12]
                     bg-[#0e0e12]/95 shadow-[0_24px_80px_-24px_rgba(0,0,0,0.85)] p-4 sm:p-5 space-y-3"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2
                id="linear-edit-issue-heading"
                className="text-[13px] font-semibold tracking-tight text-white/92"
              >
                Edit Linear task · {`${editTarget.identifier ?? "?"}`.trim()}
              </h2>
              <p className="text-[11px] text-white/45 mt-0.5 leading-snug">
                Saves to Linear immediately. Clearing the due date removes it from the issue. ESC to cancel.
              </p>
            </div>
            <button
              type="button"
              disabled={editBusy}
              aria-label="Close dialog"
              onClick={() => closeEditModal()}
              className="shrink-0 rounded-lg border border-white/[0.12] bg-white/[0.06] hover:bg-white/[0.11]
                         text-white/75 hover:text-white w-8 h-8 flex items-center justify-center text-[16px]
                         leading-none disabled:opacity-40 disabled:pointer-events-none"
            >
              ×
            </button>
          </div>

          {editError ? (
            <p className="text-[11px] text-rose-200/95 leading-snug">{editError}</p>
          ) : null}

          <label className="block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-white/40">
              Title <span className="text-red-300/85">*</span>
            </span>
            <input
              ref={editTitleInputRef}
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="Issue title"
              disabled={editBusy}
              maxLength={512}
              className="w-full text-[11.5px] rounded-md bg-white/[0.06] border border-white/[0.12] px-2 py-1.5 text-white placeholder:text-white/35"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-white/40">
              Description{" "}
              <span className="font-normal text-white/32">optional</span>
            </span>
            <textarea
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              placeholder="Markdown or plain text"
              disabled={editBusy}
              rows={4}
              className="w-full resize-y min-h-[4rem] text-[11.5px] rounded-md bg-white/[0.06] border border-white/[0.12] px-2 py-1.5 text-white placeholder:text-white/35 mono"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-white/40">
              Due date <span className="font-normal text-white/32">optional</span>
            </span>
            <input
              type="date"
              value={editDue}
              onChange={(e) => setEditDue(e.target.value)}
              disabled={editBusy}
              className="w-full text-[11.5px] rounded-md bg-white/[0.06] border border-white/[0.12] px-2 py-1.5 text-white/88 mono"
            />
            <span className="text-[10px] text-white/35 leading-snug">
              Clear the picker (empty value) before saving to remove an existing Linear due date.
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-white/[0.06]">
            <button
              type="button"
              disabled={editBusy || !editTitle.trim()}
              onClick={() => void submitEditIssue()}
              className="text-[11px] px-3 h-[28px] rounded-md bg-emerald-500/25 hover:bg-emerald-500/35 border border-emerald-400/35 text-emerald-100 disabled:opacity-45 disabled:pointer-events-none"
            >
              {editBusy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={editBusy}
              onClick={() => closeEditModal()}
              className="text-[11px] px-3 h-[28px] rounded-md bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.1] text-white/75 disabled:opacity-35"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );

  return (
    <>
      <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-3 space-y-2 w-full">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="flex flex-col gap-1 flex-1 min-w-[12rem]">
          <span className="text-[14px] sm:text-[15px] font-semibold tracking-tight text-white/[0.92] leading-tight">
            My Tasks
          </span>
          {expanded ? (
            <span className="text-[10px] sm:text-[10.5px] text-white/40 leading-snug">
              {typeof onBriefReadySendToCursor === "function"
                ? "Click a row for agent brief, Edit for Linear fields (title · description · due), Done to complete."
                : "Issues from connected orgs in Settings. Edit updates title/description/due; Done completes in Linear."}
            </span>
          ) : (
            <span className="text-[10px] text-white/38">
              {loading ? "Loading…" : `${rows.length} open — expand for list & brief`}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2 shrink-0 ml-auto">
          <button
            type="button"
            onClick={toggleExpanded}
            aria-expanded={expanded}
            title={expanded ? "Collapse My Tasks (compact bar)" : "Expand My Tasks (full list)"}
            className="shrink-0 inline-flex items-center gap-1 text-[11px] px-2.5 h-[26px] rounded-md bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.12] text-white/75 hover:text-white"
          >
            {expanded ? (
              <>
                <ChevronUpTiny className="opacity-85" /> Collapse
              </>
            ) : (
              <>
                <ChevronDownTiny className="opacity-85" /> Expand
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setCreateError(null);
              setCreateOpen(true);
            }}
            className="shrink-0 text-[11px] px-3 h-[26px] rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/35 text-emerald-100"
          >
            Add task
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadAll()}
            className="shrink-0 text-[11px] px-3 h-[26px] rounded-md bg-violet-500/20 hover:bg-violet-500/30 border border-violet-400/35 text-violet-100 disabled:opacity-45"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {!expanded ? null : (
        <>
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

      {busyEnrichRow ? (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-white/[0.12] bg-white/[0.06] px-3 py-2 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]"
        >
          <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[11px] font-medium text-white/90 tracking-tight">
            Agent brief
          </span>
          <span className="text-[10px] text-white/50">LLM drafting —</span>
          <span className="tabular-nums text-[11px] font-mono font-medium text-white">
            {(Math.floor(briefElapsedSec * 10) / 10).toFixed(1)}s
          </span>
          <span className="h-px flex-1 min-w-[2rem] max-w-[6rem] bg-gradient-to-r from-white/25 via-white/10 to-transparent" />
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
            const identRaw = row.identifier?.trim() || "";
            const canMarkDone = identRaw.length > 0 && identRaw !== "?";
            const rowBusyBrief = !!busyEnrichRow;
            const rowDimmed = rowBusyBrief && busyEnrichRow !== key;

            return (
              <div
                key={key}
                className={`flex w-full items-center gap-1 pl-2.5 pr-1 py-1 min-h-[2.75rem] group/row transition-colors ${
                  busyEnrichRow === key ? "bg-white/[0.035]" : "hover:bg-white/[0.02]"
                } ${rowDimmed ? "opacity-40 pointer-events-none" : ""}`}
              >
                <button
                  type="button"
                  disabled={rowBusyBrief}
                  className={`flex-1 min-w-0 text-left py-1 pr-2 rounded-lg -mr-1
                    transition-colors
                    hover:bg-transparent
                    disabled:pointer-events-none ${rowBusyBrief ? "cursor-default" : ""}`}
                  onClick={() => void (async () => {
                    const base = formatLinearIssueAsWorkspaceTask(row);
                    const identUpper = identRaw && identRaw !== "?" ? identRaw.toUpperCase() : null;
                    if (typeof onLinearIssueFocus === "function") {
                      onLinearIssueFocus(identUpper);
                    }
                    if (!identRaw || identRaw === "?") {
                      onFillTask(base);
                      say("This issue has no Linear identifier.", "warn");
                      return;
                    }

                    briefStartRef.current =
                      typeof performance !== "undefined" ? performance.now() : Date.now();
                    setBriefTick(0);
                    setBusyEnrichRow(key);
                    say(`Synthesizing agent brief for ${identRaw}…`, "info");
                    try {
                      const out = await fetchLinearIssueAgentBrief(identRaw, base);
                      onFillTask(out.task_text);
                      const hasBriefCursor = typeof onBriefReadySendToCursor === "function";
                      const warnLinear = !!(out.linear_error && !out.linear_updated);
                      if (hasBriefCursor) {
                        say(
                          `Agent brief ready for ${identRaw}${out.linear_updated ? " (Linear description synced)" : ""}.${warnLinear ? ` Note: ${out.linear_error}` : ""} Sending to Cursor…`,
                          warnLinear ? "warn" : "success",
                        );
                        await onBriefReadySendToCursor(out.task_text);
                        return;
                      }
                      if (out.linear_updated)
                        say(`Loaded brief for ${identRaw} and synced to Linear description.`, "success");
                      else if (out.linear_error)
                        say(
                          `${identRaw}: brief ready; Linear wasn't updated (${out.linear_error}).`,
                          "warn",
                        );
                      else say(`Loaded agent-ready brief for ${identRaw}.`, "success");
                    } catch (err) {
                      onFillTask(base);
                      say(
                        `Used raw Linear bundle for ${identRaw} (${String((err as Error)?.message || err)}).`,
                        "warn",
                      );
                    } finally {
                      briefStartRef.current = null;
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
                <button
                  type="button"
                  aria-label={canMarkDone ? `Edit ${identRaw}` : "Issue has no Linear id"}
                  title={canMarkDone ? "Edit title, description, due date" : "No Linear id"}
                  disabled={rowBusyBrief || editBusy || markDoneKey === key || !canMarkDone}
                  className="
                    shrink-0 h-8 px-2.5 rounded-md
                    border border-white/[0.08] bg-black/28
                    text-white/72 text-[10px] font-semibold uppercase tracking-[0.08em]
                    transition-[color,background-color,border-color,transform] duration-150 ease-out
                    hover:border-violet-400/35 hover:bg-violet-500/[0.12] hover:text-violet-100
                    disabled:opacity-28 disabled:pointer-events-none active:scale-[0.96]
                  "
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    beginEditIssue(row);
                  }}
                >
                  Edit
                </button>
                <button
                  title={canMarkDone ? `Mark ${identRaw} done` : "No Linear id"}
                  disabled={rowBusyBrief || markDoneKey === key || !canMarkDone}
                  className="
                    shrink-0 flex h-8 w-8 items-center justify-center rounded-full
                    border border-white/[0.06] bg-black/30
                    text-white/42 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]
                    transition-[color,background-color,border-color,transform] duration-150 ease-out
                    hover:border-emerald-400/30 hover:bg-emerald-500/[0.12] hover:text-emerald-100
                    hover:shadow-[0_0_0_1px_rgba(52,211,153,0.12),inset_0_1px_0_0_rgba(255,255,255,0.06)]
                    group-hover/row:border-white/[0.1] group-hover/row:bg-white/[0.04]
                    disabled:opacity-30 disabled:pointer-events-none disabled:border-white/[0.04] disabled:shadow-none
                    active:scale-[0.94]
                  "
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void markRowDone(key, identRaw);
                  }}
                >
                  {markDoneKey === key ? (
                    <span
                      className="inline-block size-3.5 rounded-full border-2 border-emerald-400/25 border-t-emerald-400 animate-spin opacity-95"
                      aria-hidden
                    />
                  ) : (
                    <DoneCheckIcon className="size-[13px]" />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      ) : !loading && rows.length > 0 && filteredRows.length === 0 ? (
        <p className="text-[11px] text-white/38">No issues match this workspace filter.</p>
      ) : null}

      {!loading && rows.length === 0 && errs.length === 0 ? (
        <p className="text-[11px] text-white/38">No open issues assigned to you in Linear.</p>
      ) : null}
        </>
      )}
      </div>
      {createModal}
      {editModal}
    </>
  );
}

function ChevronUpTiny({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`size-3 shrink-0 ${className ?? ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m18 15-6-6-6 6" />
    </svg>
  );
}

function ChevronDownTiny({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`size-3 shrink-0 ${className ?? ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function DoneCheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`shrink-0 ${className ?? ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
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
