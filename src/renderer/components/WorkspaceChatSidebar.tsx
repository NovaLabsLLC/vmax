import React, { useCallback, useEffect, useState } from "react";

type Row = {
  id: string;
  title: string;
  updatedAt: number;
  createdAt: number;
  repoName: string | null;
  repoPath: string | null;
};

type Props = {
  activeSessionId: string | null;
  onActiveSessionChange: (id: string | null) => void;
};

/** Left rail listing every saved Workspace chat (`exec-sessions.json`). */
export default function WorkspaceChatSidebar({ activeSessionId, onActiveSessionChange }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [clearingAll, setClearingAll] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setRows(await window.exec.listSessions());
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const off = window.exec.onSessionsUpdated(() => void refresh());
    return () => off();
  }, [refresh]);

  async function createChat() {
    const s = await window.exec.newSession({});
    await refresh();
    const id = s?.id as string | undefined;
    if (id) onActiveSessionChange(id);
  }

  async function deleteChat(id: string) {
    await window.exec.deleteSession(id);
    const nextRows = await window.exec.listSessions();
    setRows(nextRows);
    if (activeSessionId === id) {
      onActiveSessionChange(nextRows[0]?.id ?? null);
    }
  }

  async function clearAllChats() {
    if (rows.length === 0) return;
    const okToDelete = window.confirm(
      `Delete all ${rows.length} chat${rows.length === 1 ? "" : "s"}? This can't be undone.`,
    );
    if (!okToDelete) return;
    setClearingAll(true);
    try {
      try {
        await window.exec.clearSessions();
      } catch {
        // Older main process without `sessions:clear`, or hot-reload mismatch — delete one-by-one.
        const list = await window.exec.listSessions();
        for (const r of list) {
          await window.exec.deleteSession(r.id);
        }
      }
      onActiveSessionChange(null);
      await refresh();
    } finally {
      setClearingAll(false);
    }
  }

  function selectChat(id: string) {
    if (id === activeSessionId) return;
    onActiveSessionChange(id);
  }

  return (
    <aside className="w-[clamp(190px,24vw,240px)] shrink-0 flex flex-col border-r border-white/[0.1] bg-white/[0.03] backdrop-blur-sm">
      <div className="p-3 border-b border-white/[0.07] shrink-0">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/42">Chats</div>
        <p className="text-[10px] text-white/38 leading-snug mt-1">All sessions save here automatically.</p>
        <button
          type="button"
          onClick={() => void createChat()}
          className="mt-2.5 w-full h-8 rounded-lg text-[11px] font-medium bg-white text-black border border-white
                       hover:bg-white/90 hover:border-white/95"
        >
          + New chat
        </button>
        <button
          type="button"
          disabled={rows.length === 0 || clearingAll}
          onClick={() => void clearAllChats()}
          title="Remove every saved chat from this Mac"
          className="mt-1.5 w-full h-7 rounded-lg text-[10.5px] font-medium bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.10] text-white/75 hover:text-white disabled:opacity-35 disabled:pointer-events-none"
        >
          {clearingAll ? "Clearing…" : "Clear all"}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-0.5">
        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/[0.1] px-2.5 py-3 text-[10px] text-white/40 leading-snug mx-1">
            No chats yet — ask anything in Workspace or tap <span className="text-white/75">New chat</span>.
          </div>
        ) : (
          rows.map((r) => (
            <div
              key={r.id}
              className={`group rounded-lg border px-2 py-1.5 flex items-start gap-1.5 transition-colors ${
                r.id === activeSessionId
                  ? "bg-white/[0.08] border-white/[0.14]"
                  : "bg-transparent border-transparent hover:bg-white/[0.05]"
              }`}
            >
              <button
                type="button"
                onClick={() => selectChat(r.id)}
                title={r.title}
                className="flex-1 min-w-0 text-left pt-px"
              >
                <div className="flex items-start gap-1.5">
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${
                      r.id === activeSessionId ? "bg-emerald-400" : "bg-white/30"
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="text-[11.5px] font-medium text-white/[0.95] truncate leading-tight">{r.title || "Untitled"}</div>
                    <div className="text-[9.5px] text-white/40 truncate mt-0.5 tabular-nums">
                      {r.repoName ? <>{r.repoName} · </> : null}
                      {fmtTime(r.updatedAt)}
                    </div>
                  </div>
                </div>
              </button>
              <button
                type="button"
                className="shrink-0 opacity-40 group-hover:opacity-90 text-[12px] leading-none px-1 text-white/55 hover:text-rose-300"
                title="Delete chat"
                onClick={(e) => {
                  e.stopPropagation();
                  void deleteChat(r.id);
                }}
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

function fmtTime(t: number) {
  if (!t) return "";
  const d = new Date(t);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
