import React from "react";
import type { RepoContext } from "../types";

type Props = {
  repo: RepoContext | null;
  onRescan: () => void;
};

export default function RepoSidebar({ repo, onRescan }: Props) {
  return (
    <aside className="w-[260px] shrink-0 border-r border-white/5 bg-[#0c0c0f] p-4 overflow-y-auto term-scroll">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] uppercase tracking-[0.14em] text-white/40">Repo</div>
        {repo?.ok && (
          <button
            onClick={onRescan}
            className="text-[10px] text-white/40 hover:text-white/80 px-1.5 py-0.5 rounded"
            title="Rescan"
          >
            ↻
          </button>
        )}
      </div>

      {!repo && <Empty msg="No repo loaded yet." />}
      {repo && !repo.ok && <Empty msg={repo.error} tone="error" />}

      {repo?.ok && (
        <div className="space-y-3">
          <Card label="Name">
            <div className="text-[13px] font-medium text-white truncate" title={repo.root}>
              {repo.name}
            </div>
            <div className="text-[10px] text-white/35 truncate" title={repo.root}>
              {repo.root}
            </div>
          </Card>

          <Card label="Branch">
            <div className="text-[12.5px] mono text-emerald-300">{repo.branch}</div>
          </Card>

          <Card label={`Changed files (${repo.changedFiles.length})`}>
            {repo.changedFiles.length === 0 ? (
              <div className="text-[11.5px] text-white/40">working tree clean</div>
            ) : (
              <div className="space-y-1">
                {repo.changedFiles.slice(0, 30).map((f) => (
                  <div key={f} className="text-[11.5px] mono text-white/75 truncate" title={f}>
                    {f}
                  </div>
                ))}
                {repo.changedFiles.length > 30 && (
                  <div className="text-[10px] text-white/40">+{repo.changedFiles.length - 30} more</div>
                )}
              </div>
            )}
          </Card>

          <Card label="git status">
            {repo.status.length === 0 ? (
              <div className="text-[11.5px] text-white/40">clean</div>
            ) : (
              <div className="space-y-0.5">
                {repo.status.slice(0, 12).map((s, i) => (
                  <div key={i} className="text-[11.5px] mono text-white/70 truncate">{s}</div>
                ))}
              </div>
            )}
          </Card>

          {repo.diffStat && (
            <Card label="diff stat">
              <pre className="text-[10.5px] mono text-white/55 whitespace-pre-wrap leading-snug">
                {repo.diffStat}
              </pre>
            </Card>
          )}
        </div>
      )}
    </aside>
  );
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
      <div className="text-[9.5px] uppercase tracking-[0.14em] text-white/35 mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function Empty({ msg, tone }: { msg: string; tone?: "error" }) {
  return (
    <div className={`text-[12px] ${tone === "error" ? "text-red-300/80" : "text-white/45"}`}>
      {msg}
    </div>
  );
}
