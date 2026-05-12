import React, { useId } from "react";
import type { AgentRunState, ExecAgent } from "../types";

type CliRow = { installed: boolean; authed?: boolean; version?: string; authVia?: string };

export type AgentsCliPayload = { claude: CliRow; codex: CliRow };

function isMacPlatform() {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || "") || navigator.userAgent.includes("Mac OS X");
}

export type AgentsConnectionGraphProps = {
  cli: AgentsCliPayload | null;
  live: Partial<Record<ExecAgent, AgentRunState>>;
  /** Tighter max height when embedded (e.g. Live agents strip). */
  variant?: "full" | "compact";
};

/**
 * SVG hub-and-spokes: Vmax ⇄ Claude / Codex / Cursor when each bridge reports ready.
 * `live[*] === "running"` thickens edges and pulses the peripheral ring + “running…”.
 */
export default function AgentsConnectionGraph({
  cli,
  live,
  variant = "full",
}: AgentsConnectionGraphProps) {
  const gradId = `agents-edge-${useId().replace(/:/g, "")}`;
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
  const orbit = variant === "compact" ? 118 : 132;
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

  const svgClass =
    variant === "compact"
      ? "w-full block aspect-[420/360] max-h-[min(200px,32vh)] h-auto mx-auto"
      : "w-full block aspect-[420/360] max-h-[min(520px,62vh)] h-auto";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={svgClass} role="img" aria-label="Vmax agent connections">
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
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
          stroke={`url(#${gradId})`}
          strokeWidth={live[node.id] === "running" ? 2.2 : 1.2}
        />
      ))}

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
  );
}
