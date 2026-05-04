import React, { useEffect, useState } from "react";
import type { RepoContext } from "../types";

type RepoCard = { path: string; ctx: RepoContext | null };

export default function HomePanel({
  profileName,
  onGoSettings,
}: {
  profileName?: string;
  onGoSettings: () => void;
}) {
  const [recents, setRecents] = useState<RepoCard[]>([]);
  const [busy, setBusy] = useState(false);
  const [task, setTask] = useState("");

  useEffect(() => {
    (async () => {
      const paths = await window.exec.getRecentRepos();
      const cards = await Promise.all(paths.map(async (p) => ({ path: p, ctx: await window.exec.scanRepo(p) })));
      setRecents(cards);
    })();
  }, []);

  const primary = recents[0];

  async function startExec(repoPath?: string) {
    setBusy(true);
    try {
      if (repoPath) await window.exec.rememberRepo(repoPath);
      await window.exec.openOverlay();
    } finally { setBusy(false); }
  }
  async function pickAndStart() {
    setBusy(true);
    try {
      const p = await window.exec.pickRepo();
      if (!p) return;
      await window.exec.rememberRepo(p);
      await window.exec.openOverlay();
    } finally { setBusy(false); }
  }

  return (
    <div className="max-w-[760px] mx-auto px-6 pt-6 pb-10 space-y-6">
      {/* Hero */}
      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-white text-black flex items-center justify-center text-[15px] font-bold shrink-0">E</div>
          <div className="flex-1 min-w-0">
            <div className="text-[15.5px] font-semibold tracking-tight">
              {profileName ? `Ready when you are, ${profileName}.` : "Ready when you are."}
            </div>
            <div className="text-[12.5px] text-white/55 leading-relaxed mt-0.5">
              One button starts an AI control layer. It sees your repo and task, plans, runs checks,
              explains failures, and tells Cursor exactly what to do next.
            </div>
          </div>
        </div>

        <div className="mt-4">
          <textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            rows={2}
            placeholder="Optional — paste a Linear ticket. You can also do this after Start."
            className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl
                       px-3 py-2 text-[13px] text-white placeholder-white/30 leading-relaxed
                       outline-none focus:border-white/20 resize-none"
          />
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={() => startExec(primary?.path)}
            disabled={busy}
            className={`h-10 px-5 rounded-xl text-[13px] font-medium tracking-tight
                        bg-white text-black hover:bg-white/90
                        shadow-[0_0_24px_-4px_rgba(255,255,255,0.45)]
                        ${busy ? "opacity-60 cursor-wait" : ""}`}
          >
            {busy ? "Starting…" : primary ? `Start Exec — ${primary.ctx?.ok ? primary.ctx.name : basename(primary.path)}` : "Start Exec"}
          </button>
          <button
            onClick={pickAndStart}
            disabled={busy}
            className="h-10 px-3 rounded-xl text-[12.5px] text-white/75 hover:text-white
                       bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08]"
          >
            Pick a different repo…
          </button>
        </div>
      </section>

      {primary && (
        <Section title="Active project">
          <ProjectCard card={primary} onClick={() => startExec(primary.path)} primary />
        </Section>
      )}

      {recents.length > 1 && (
        <Section title="Recent projects">
          <div className="grid grid-cols-2 gap-2">
            {recents.slice(1).map((r) => (
              <ProjectCard key={r.path} card={r} onClick={() => startExec(r.path)} />
            ))}
          </div>
        </Section>
      )}

      <Section title="What Exec thinks you should do next">
        <div className="space-y-1.5">
          {buildSuggestions(primary).map((s, i) => (
            <SuggestionRow key={i} text={s.text} action={s.action} onClick={() => startExec(primary?.path)} />
          ))}
        </div>
      </Section>

      <Section title="Reminders">
        <div className="space-y-1.5">
          <ReminderRow tone="info" text="Daily standup at 10:00." />
          <ReminderRow tone="warn" text="Open PR #142 has 1 unresolved comment from Mike." />
          <ReminderRow tone="success" text="Last typecheck on this repo: clean." />
        </div>
      </Section>

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

function SuggestionRow({ text, action, onClick }: { text: string; action: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-lg bg-white/[0.025] border border-white/[0.05]
                 hover:bg-white/[0.05] hover:border-white/[0.10] transition-colors
                 px-3 py-2 flex items-center gap-3"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-sky-400/90" />
      <span className="text-[12.5px] text-white/85 flex-1">{text}</span>
      <span className="text-[10.5px] text-white/45">{action}</span>
    </button>
  );
}

function ReminderRow({ text, tone }: { text: string; tone: "info" | "warn" | "success" }) {
  const dot =
    tone === "warn" ? "bg-amber-400"
    : tone === "success" ? "bg-emerald-400"
    : "bg-white/45";
  return (
    <div className="rounded-lg bg-white/[0.02] border border-white/[0.05] px-3 py-2 flex items-center gap-3">
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      <span className="text-[12.5px] text-white/80">{text}</span>
    </div>
  );
}

function basename(p: string) { return p.split("/").filter(Boolean).pop() || p; }
function buildSuggestions(primary: RepoCard | undefined): { text: string; action: string }[] {
  if (!primary || !primary.ctx?.ok) return [{ text: "Pick a repo to get tactical, repo-aware suggestions.", action: "Start →" }];
  const ctx = primary.ctx;
  const out: { text: string; action: string }[] = [];
  if (ctx.changedFiles.length > 0)
    out.push({ text: `Summarize the diff in ${ctx.name} (${ctx.changedFiles.length} files changed).`, action: "Open Exec →" });
  out.push({ text: `Run a typecheck on ${ctx.name} before pushing ${ctx.branch}.`, action: "Open Exec →" });
  out.push({ text: "Plan a task — paste your Linear ticket and Exec drafts a tactical plan.", action: "Open Exec →" });
  return out;
}
