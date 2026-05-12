/**
 * Parse pill / voice text into per-agent prompts.
 *
 * Format (case-insensitive agent token):
 *
 * <<<VMAX:AGENT:claude>>>
 * First agent instructions…
 *
 * <<<VMAX:AGENT:codex>>>
 * Second agent instructions…
 *
 * Optional preamble before the first marker is merged into the first agent block.
 *
 * <<<VMAX:AGENT:cursor>>> is supported. Two or more distinct agents required (order follows markers).
 *
 * @param {string} raw
 * @returns {{ agent: string; prompt: string }[] | null}
 */
function parsePillDualAgentPrompts(raw) {
  const t = String(raw || "").trim();
  if (!t) return null;
  const delim = /<<<VMAX:AGENT:\s*(claude|codex|cursor|cl|co|cu)\s*>>>/gi;
  const matches = [...t.matchAll(delim)];
  if (matches.length < 2) return null;

  const preambleIdx = matches[0].index || 0;
  const preamble = t.slice(0, preambleIdx).trim();

  /** @type {{ agent: string; lo: number; hi: number }[]} */
  const spans = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const token = String(m[1] || "").toLowerCase().replace(/\s+/g, "");
    let agent =
      token === "claude" || token === "cl"
        ? "claude"
        : token === "codex" || token === "co"
          ? "codex"
          : token === "cursor" || token === "cu"
            ? "cursor"
            : null;
    if (!agent) return null;
    const lo = (m.index || 0) + m[0].length;
    const hi = i + 1 < matches.length ? matches[i + 1].index || t.length : t.length;
    spans.push({ agent, lo, hi });
  }

  /** @type {{ agent: string; prompt: string }[]} */
  const ordered = [];
  const seenAgents = new Set();
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

module.exports = { parsePillDualAgentPrompts };

function selfTest() {
  const parse = parsePillDualAgentPrompts;

  /** @type { readonly [string,string,(r:any)=>boolean][] } */
  const cases = [
    ["empty rejects", "", (r) => r === null],
    ["single marker rejects", "<<<VMAX:AGENT:claude>>> only", (r) => r === null],
    [
      "two blocks ordered",
      `<<<VMAX:AGENT:claude>>>
do backend
<<<VMAX:AGENT:codex>>>
read tests`,
      (r) =>
        Array.isArray(r) &&
        r.length === 2 &&
        r[0].agent === "claude" &&
        /do backend/.test(r[0].prompt) &&
        r[1].agent === "codex" &&
        /read tests/.test(r[1].prompt),
    ],
    [
      "preamble merges into first segment",
      `Shared instructions.
<<<VMAX:AGENT:co>>>
a
<<<VMAX:AGENT:cu>>>
b`,
      (r) =>
        Array.isArray(r) &&
        r.length === 2 &&
        r[0].agent === "codex" &&
        /Shared instructions/.test(r[0].prompt) &&
        /\n\na\b/m.test(r[0].prompt) &&
        r[1].agent === "cursor" &&
        r[1].prompt.trim() === "b",
    ],
    [
      "reuse same agent rejects",
      `<<<VMAX:AGENT:claude>>>x<<<VMAX:AGENT:claude>>>y`,
      (r) => r === null,
    ],
  ];

  for (const [title, inp, chk] of cases) {
    try {
      const out = parse(inp);
      if (!chk(out)) throw new Error(`unexpected → ${JSON.stringify(out)}`);
    } catch (e) {
      console.error("[pillPromptSplit.selfTest]", title, e);
      process.exit(1);
    }
  }
  console.log(`pillPromptSplit self-test ok (${cases.length} cases)`);
}

if (require.main === module) selfTest();
