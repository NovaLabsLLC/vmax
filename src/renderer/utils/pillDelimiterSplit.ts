/**
 * Same grammar as `utils/pillPromptSplit.js` (Electron + node tests).
 * Duplicated here so Vite can bundle the overlay without CJS interop issues.
 * If you change markers or aliases, update both files.
 */
export function parsePillDualAgentPrompts(raw: string): { agent: string; prompt: string }[] | null {
  const t = String(raw || "").trim();
  if (!t) return null;
  const delim = /<<<VMAX:AGENT:\s*(claude|codex|cursor|cl|co|cu)\s*>>>/gi;
  const matches = [...t.matchAll(delim)];
  if (matches.length < 2) return null;

  const preambleIdx = matches[0].index ?? 0;
  const preamble = t.slice(0, preambleIdx).trim();

  const spans: { agent: string; lo: number; hi: number }[] = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const token = String(m[1] || "").toLowerCase().replace(/\s+/g, "");
    let agent: string | null =
      token === "claude" || token === "cl"
        ? "claude"
        : token === "codex" || token === "co"
          ? "codex"
          : token === "cursor" || token === "cu"
            ? "cursor"
            : null;
    if (!agent) return null;
    const lo = (m.index ?? 0) + m[0].length;
    const hi = i + 1 < matches.length ? matches[i + 1].index ?? t.length : t.length;
    spans.push({ agent, lo, hi });
  }

  const ordered: { agent: string; prompt: string }[] = [];
  const seenAgents = new Set<string>();
  for (let i = 0; i < spans.length; i++) {
    const sp = spans[i];
    let body = t.slice(sp.lo, sp.hi).trim();
    if (!body) return null;
    if (i === 0 && preamble) {
      body = `${preamble}\n\n${body}`;
    }
    if (seenAgents.has(sp.agent)) return null;
    seenAgents.add(sp.agent);
    ordered.push({ agent: sp.agent, prompt: body });
  }
  if (ordered.length < 2) return null;

  return ordered;
}
