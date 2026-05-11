import React, { useEffect, useState } from "react";
import type { AgentRunState, ExecAgent } from "../types";

type CliRow = { installed: boolean; authed?: boolean; version?: string; authVia?: string };

function isMacPlatform() {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || "") || navigator.userAgent.includes("Mac OS X");
}

export default function AgentsPanel({ onGoSettings }: { onGoSettings?: () => void }) {
  const [cli, setCli] = useState<{ claude: CliRow; codex: CliRow } | null>(null);
  const [live, setLive] = useState<Partial<Record<ExecAgent, AgentRunState>>>({});

  async function refresh() {
    try {
      setCli(await window.exec.cliStatus());
    } catch {
      setCli(null);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (typeof window.exec.onAgentsStatus !== "function") return () => {};
    return window.exec.onAgentsStatus((evt) => {
      setLive((prev) => {
        const next = { ...prev };
        if (evt.state === "running") next[evt.agent] = "running";
        else delete next[evt.agent];
        return next;
      });
    });
  }, []);

  const mac = isMacPlatform();
  const connected = [
    {
      id: "claude" as const,
      label: "Claude Code",
      detail: cli?.claude?.version ? `v${cli.claude.version}` : "Anthropic CLI",
      ok: !!(cli?.claude?.installed && cli?.claude?.authed),
    },
    {
      id: "codex" as const,
      label: "Codex",
      detail: cli?.codex?.version ? `v${cli.codex.version}` : "OpenAI CLI",
      ok: !!(cli?.codex?.installed && cli?.codex?.authed),
    },
    {
      id: "cursor" as const,
      label: "Cursor",
      detail: "Editor bridge",
      ok: mac,
    },
  ].filter((a) => a.ok);

  const W = 420;
  const H = 360;
  const cx = W / 2;
  const cy = H / 2;
  const orbit = 132;
  const n = connected.length;

  const nodes =
    n === 0
      ? []
      : connected.map((a, i) => {
          const angle = -Math.PI / 2 + (i * (2 * Math.PI)) / n;
          return {
            ...a,
            x: cx + Math.cos(angle) * orbit,
            y: cy + Math.sin(angle) * orbit,
          };
        });

  return (
    <div className="w-full max-w-none box-border px-4 sm:px-6 lg:px-8 pt-6 pb-10 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[18px] font-semibold tracking-tight">Agents</div>
          <div className="text-[12.5px] text-white/50 mt-0.5">
            Bridges wired into Vmax. Nodes appear when a tool is ready — Claude / Codex via CLI auth, Cursor on macOS.
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="no-drag shrink-0 h-9 px-3 rounded-lg text-[11.5px] font-medium bg-white/[0.08] hover:bg-white/[0.12] border border-white/[0.12] text-white/85"
        >
          Refresh status
        </button>
      </div>

      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full block aspect-[420/360] max-h-[min(520px,62vh)] h-auto"
          role="img"
          aria-label="Vmax agent connections"
        >
          <defs>
            <linearGradient id="agents-edge" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(255,255,255,0.04)" />
              <stop offset="50%" stopColor="rgba(255,255,255,0.14)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0.04)" />
            </linearGradient>
          </defs>

          {nodes.map((node) => (
            <line
              key={node.id}
              x1={cx}
              y1={cy}
              x2={node.x}
              y2={node.y}
              stroke="url(#agents-edge)"
              strokeWidth={live[node.id] === "running" ? 2.2 : 1.2}
            />
          ))}

          {/* Vmax hub */}
          <g transform={`translate(${cx},${cy})`}>
            <circle r="56" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
            <circle r="48" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={1} strokeDasharray="4 6" />
            <text
              textAnchor="middle"
              y="-6"
              fill="rgba(255,255,255,0.9)"
              style={{ fontFamily: "inherit", fontSize: "13px", fontWeight: 600 }}
            >
              Vmax
            </text>
            <text textAnchor="middle" y="14" fill="rgba(255,255,255,0.4)" style={{ fontFamily: "inherit", fontSize: "9px" }}>
              control layer
            </text>
          </g>

          {nodes.map((node) => {
            const pulse = live[node.id] === "running";
            const strokeCol =
              node.id === "claude"
                ? pulse
                  ? "rgba(251,191,36,0.85)"
                  : "rgba(251,191,36,0.35)"
                : node.id === "codex"
                  ? pulse
                    ? "rgba(52,211,153,0.85)"
                    : "rgba(52,211,153,0.35)"
                  : pulse
                    ? "rgba(167,139,250,0.85)"
                    : "rgba(167,139,250,0.35)";
            return (
              <g key={node.id} transform={`translate(${node.x},${node.y})`}>
                <circle
                  r="46"
                  fill="rgba(255,255,255,0.04)"
                  stroke={strokeCol}
                  strokeWidth={pulse ? 2 : 1.2}
                  className={pulse ? "animate-pulse" : undefined}
                />
                <circle r="40" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
                <text
                  textAnchor="middle"
                  y="-6"
                  fill="rgba(255,255,255,0.95)"
                  style={{ fontFamily: "inherit", fontSize: "11.5px", fontWeight: 600 }}
                >
                  {node.label}
                </text>
                <text textAnchor="middle" y="10" fill="rgba(255,255,255,0.38)" style={{ fontFamily: "inherit", fontSize: "9px" }}>
                  {node.detail}
                </text>
                {pulse ? (
                  <text
                    textAnchor="middle"
                    y="26"
                    fill="rgba(110,231,183,0.9)"
                    style={{ fontFamily: "inherit", fontSize: "8.5px", fontWeight: 600 }}
                  >
                    running…
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>

        {n === 0 ? (
          <div className="text-center pt-2 pb-1 space-y-2">
            <p className="text-[12.5px] text-white/45">
              No agent bridges are connected yet. Install and log in to Claude Code or Codex under Settings, or use Vmax on macOS for Cursor.
            </p>
            {onGoSettings ? (
              <button
                type="button"
                onClick={onGoSettings}
                className="no-drag h-9 px-4 rounded-lg text-[12px] font-medium bg-white text-black hover:bg-white/90"
              >
                Open Settings
              </button>
            ) : null}
          </div>
        ) : (
          <p className="text-center text-[10.5px] text-white/35 pt-3">
            Voice dispatch from the pill routes into these tools when a repo is active. A pulsing ring and “running…” means that bridge is busy.
          </p>
        )}

        {cli && (!cli.claude?.installed || !cli.claude?.authed || !cli.codex?.installed || !cli.codex?.authed) ? (
          <div className="mt-4 rounded-xl border border-white/[0.06] bg-black/25 px-3 py-2 text-[10.5px] text-white/40 leading-relaxed">
            {!cli.claude?.installed || !cli.claude?.authed ? (
              <div>Claude Code: {!cli.claude?.installed ? "not installed" : "sign in required"}</div>
            ) : null}
            {!cli.codex?.installed || !cli.codex?.authed ? (
              <div>Codex: {!cli.codex?.installed ? "not installed" : "sign in required"}</div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
