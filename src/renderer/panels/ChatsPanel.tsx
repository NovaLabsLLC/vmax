import React, { useEffect, useState } from "react";

type Row = {
  id: string;
  title: string;
  updatedAt: number;
  createdAt: number;
  repoName: string | null;
  repoPath: string | null;
};

type Props = {
  activeId: string | null;
  onOpen: (id: string) => void;   // open existing chat in workspace
  onNew: (id: string) => void;    // open a freshly-created chat in workspace
};

export default function ChatsPanel({ activeId, onOpen, onNew }: Props) {
  const [rows, setRows] = useState<Row[]>([]);

  async function refresh() {
    setRows(await window.exec.listSessions());
  }
  useEffect(() => { refresh(); }, []);

  async function createChat() {
    const s = await window.exec.newSession();
    await refresh();
    onNew(s.id);
  }

  async function deleteChat(id: string) {
    await window.exec.deleteSession(id);
    await refresh();
  }

  return (
    <div className="max-w-[760px] mx-auto px-6 pt-6 pb-12 space-y-4">
      <div className="flex items-center gap-3">
        <div>
          <div className="text-[18px] font-semibold tracking-tight">Chats</div>
          <div className="text-[12.5px] text-white/50 mt-0.5">
            Each chat keeps its task, plan, and run history. Click any to continue.
          </div>
        </div>
        <button
          onClick={createChat}
          className="ml-auto h-9 px-4 rounded-lg text-[12.5px] font-medium bg-white text-black hover:bg-white/90
                     shadow-[0_0_24px_-4px_rgba(255,255,255,0.4)]"
        >
          + New chat
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 text-[13px] text-white/65">
          No chats yet. Hit <span className="text-white font-medium">+ New chat</span> to start one — or
          ask a voice question from the pill and a chat will be created for you.
        </div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <ChatRow
              key={r.id}
              row={r}
              active={r.id === activeId}
              onOpen={() => onOpen(r.id)}
              onDelete={() => deleteChat(r.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ChatRow({
  row, active, onOpen, onDelete,
}: { row: Row; active: boolean; onOpen: () => void; onDelete: () => void }) {
  return (
    <div
      className={`group rounded-xl border px-3 py-2 flex items-center gap-3 transition-colors
        ${active
          ? "bg-emerald-500/[0.06] border-emerald-400/25"
          : "bg-white/[0.025] border-white/[0.06] hover:bg-white/[0.05] hover:border-white/[0.10]"}`}
    >
      <button onClick={onOpen} className="flex-1 min-w-0 text-left flex items-center gap-3">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${active ? "bg-emerald-400" : "bg-white/35"}`} />
        <div className="min-w-0">
          <div className="text-[12.5px] font-medium text-white truncate">{row.title || "Untitled"}</div>
          <div className="text-[10.5px] text-white/45 truncate">
            {row.repoName ? <>{row.repoName} · </> : null}
            {fmtTime(row.updatedAt)}
          </div>
        </div>
      </button>
      <button
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-[10.5px] text-white/40 hover:text-red-300 px-1.5"
        title="Delete chat"
      >
        ×
      </button>
    </div>
  );
}

function fmtTime(t: number) {
  if (!t) return "";
  const d = new Date(t);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? `Today ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
