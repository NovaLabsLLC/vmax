import React, { useEffect, useRef, useState } from "react";
import type { RepoContext } from "../types";

type RepoCard = { path: string; ctx: RepoContext | null };
type StartChatOpts = { repoPath?: string; question?: string };

export default function HomePanel({
  profileName,
  repoListEpoch = 0,
  onStartChat,
}: {
  profileName?: string;
  repoListEpoch?: number;
  onStartChat: (opts?: StartChatOpts) => void;
}) {
  const [recents, setRecents] = useState<RepoCard[]>([]);
  const [task, setTask] = useState("");
  const [picking, setPicking] = useState(false);
  const submittedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const paths = await window.exec.getRecentRepos();
      const cards = await Promise.all(paths.map(async (p) => ({ path: p, ctx: await window.exec.scanRepo(p) })));
      if (!cancelled) setRecents(cards);
    })();
    return () => { cancelled = true; };
  }, [repoListEpoch]);

  const primary = recents[0];

  function startChat(opts?: StartChatOpts) {
    if (submittedRef.current) return;
    submittedRef.current = true;
    onStartChat(opts);
    // Allow another start once unmounted / view changes; reset shortly.
    setTimeout(() => { submittedRef.current = false; }, 400);
  }

  function submitTask() {
    const q = task.trim();
    setTask("");
    startChat({ repoPath: primary?.path, question: q || undefined });
  }

  async function pickRepoAndStart() {
    if (picking) return;
    setPicking(true);
    try {
      const p = await window.exec.pickRepo();
      if (!p) return;
      startChat({ repoPath: p });
    } finally {
      setPicking(false);
    }
  }

  function onTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submitTask();
    }
  }

  return (
    <div className="max-w-[760px] mx-auto px-6 pt-6 pb-10 space-y-6">
      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-white text-black flex items-center justify-center text-[15px] font-bold shrink-0">E</div>
          <div className="flex-1 min-w-0">
            <div className="text-[15.5px] font-semibold tracking-tight">
              {profileName ? `Ready when you are, ${profileName}.` : "Ready when you are."}
            </div>
            <div className="text-[12.5px] text-white/55 leading-relaxed mt-0.5">
              Type a task or paste a Linear ticket and I'll start a new chat. The floating bar pops up so you can talk it through.
            </div>
          </div>
        </div>

        <div className="mt-4">
          <textarea
            autoFocus
            value={task}
            onChange={(e) => setTask(e.target.value)}
            onKeyDown={onTextareaKeyDown}
            rows={3}
            placeholder="What are we doing? (Optional — you can also just hit New chat and talk to the bar.)"
            className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl
                       px-3 py-2.5 text-[13px] text-white placeholder-white/30 leading-relaxed
                       outline-none focus:border-white/20 resize-none"
          />
          <div className="mt-1 text-[10.5px] text-white/35">⌘↩ to start the chat</div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={submitTask}
            className="h-10 px-5 rounded-xl text-[13px] font-medium tracking-tight
                       bg-white text-black hover:bg-white/90
                       shadow-[0_0_24px_-4px_rgba(255,255,255,0.45)]"
          >
            {primary ? `New chat — ${primary.ctx?.ok ? primary.ctx.name : basename(primary.path)}` : "New chat"}
          </button>
          <button
            onClick={pickRepoAndStart}
            disabled={picking}
            className={`h-10 px-3 rounded-xl text-[12.5px] text-white/75 hover:text-white
                       bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08]
                       ${picking ? "opacity-60 cursor-wait" : ""}`}
          >
            Pick a different repo…
          </button>
        </div>
      </section>

      {primary && (
        <Section title="Active project">
          <ProjectCard card={primary} onClick={() => startChat({ repoPath: primary.path })} primary />
        </Section>
      )}

      {recents.length > 1 && (
        <Section title="Recent projects">
          <div className="grid grid-cols-2 gap-2">
            {recents.slice(1).map((r) => (
              <ProjectCard key={r.path} card={r} onClick={() => startChat({ repoPath: r.path })} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="text-[10.5px] uppercase tracking-[0.14em] text-white/40 mb-2">{title}</div>
      {children}
    </section>
  );
}

function ProjectCard({
  card, onClick, primary,
}: { card: RepoCard; onClick: () => void; primary?: boolean }) {
  const ctx = card.ctx;
  const ok = ctx?.ok === true;
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-xl border p-3 transition-colors w-full
        ${primary
          ? "bg-white/[0.04] border-white/[0.10] hover:bg-white/[0.07]"
          : "bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.05]"}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-emerald-400" : "bg-white/30"}`} />
        <div className="text-[13px] font-medium text-white truncate">
          {ok ? ctx!.name : basename(card.path)}
        </div>
        {ok && <div className="ml-auto text-[10.5px] mono text-emerald-300/85 truncate max-w-[40%]">{ctx!.branch}</div>}
      </div>
      <div className="text-[10.5px] text-white/35 mono truncate mt-0.5">{card.path}</div>
      {ok && (
        <div className="text-[10.5px] text-white/55 mt-1.5">
          {ctx!.changedFiles.length} changed file{ctx!.changedFiles.length === 1 ? "" : "s"}
          {ctx!.diffStat && <span className="text-white/35"> · {ctx!.diffStat.split("\n").pop()}</span>}
        </div>
      )}
    </button>
  );
}

function basename(p: string) { return p.split("/").filter(Boolean).pop() || p; }
