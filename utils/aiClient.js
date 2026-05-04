// Exec AI client. Wraps OpenAI / Anthropic for the three AI tasks Exec needs:
// planTask, explainFailure, summarizeDiff. Defaults to OpenAI if both keys
// are present (cheaper for plan-style requests); set ANTHROPIC_API_KEY only
// (no OPENAI_API_KEY) to force Claude.

const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";

const PLAN_SYSTEM = `You are Exec — a senior engineer assistant that turns a task + repo state into a tactical implementation plan for a coding agent (Cursor / Claude Code).

Respond ONLY in compact JSON matching this shape:
{
  "summary": string,                       // one short paragraph: what to build, in plain language
  "files": [{ "path": string, "why": string }],   // files most likely to change, with one-line reasons
  "risks": [string],                       // sharp, specific risks (regressions, edge cases, ordering)
  "command": string,                       // single shell command to run after the change to verify
  "cursorPrompt": string                   // a precise prompt to paste into Cursor / Claude Code, written in 2nd person, ≤ 6 short sentences, naming files
}
Be concrete. Reference actual files from the changed-files list when relevant. No prose outside the JSON.`;

const FAILURE_SYSTEM = `You are Exec. A command just failed in the user's repo. Diagnose like a senior engineer who has already read their codebase.

Respond ONLY in compact JSON:
{
  "what": string,                  // one-sentence: what happened, in human terms
  "likelyFile": string | null,     // most likely broken file (path)
  "cause": string,                 // 1-3 sentences explaining the underlying mismatch / bug
  "next": [string],                // 2-4 concrete next actions
  "cursorPrompt": string           // precise prompt to fix the issue. Reference exact files. Tell Cursor to run the verifying command after.
}
Be specific. If the user's task and repo state suggest the cause, name it. No prose outside the JSON.`;

const DIFF_SYSTEM = `You are Exec. Summarize this git diff like a senior reviewer.

Respond ONLY in compact JSON:
{
  "summary": string,             // 1-2 sentences: what changed and why it likely matters
  "files": [{ "path": string, "change": string }],  // per file: one-line description of change
  "risks": [string],             // concrete risks introduced
  "nextChecks": [string]         // commands or quick checks worth running
}
No prose outside the JSON.`;

async function planTask({ task, repo, diff }) {
  const user = renderRepoContext({ task, repo, diff, includeDiff: true });
  return callJSON({ system: PLAN_SYSTEM, user });
}

async function explainFailure({ task, repo, command, output }) {
  const user = `${renderRepoContext({ task, repo })}\n\nCommand: ${command}\n\n--- Output (last 8000 chars) ---\n${(output || "").slice(-8000)}`;
  return callJSON({ system: FAILURE_SYSTEM, user });
}

async function summarizeDiff({ diff, fallback }) {
  if (!diff || !diff.trim()) return { summary: "(no diff)", files: [], risks: [], nextChecks: [] };
  try {
    return await callJSON({ system: DIFF_SYSTEM, user: `--- diff ---\n${diff.slice(0, 30000)}` });
  } catch (err) {
    if (typeof fallback === "function") {
      return { summary: fallback(diff), files: [], risks: [], nextChecks: [], _error: String(err.message || err) };
    }
    throw err;
  }
}

// ---- internals ----

function renderRepoContext({ task, repo, diff, includeDiff }) {
  const lines = [];
  if (task) lines.push(`Task:\n${task}`);
  if (repo) {
    lines.push(`\nRepo: ${repo.name || "(unknown)"}`);
    if (repo.branch) lines.push(`Branch: ${repo.branch}`);
    if (repo.changedFiles?.length) lines.push(`Changed files:\n${repo.changedFiles.map((f) => "  " + f).join("\n")}`);
    if (repo.status?.length) lines.push(`git status --short:\n${repo.status.map((l) => "  " + l).join("\n")}`);
    if (repo.diffStat) lines.push(`diff --stat:\n${repo.diffStat}`);
  }
  if (includeDiff && diff) lines.push(`\n--- diff (truncated) ---\n${diff.slice(0, 12000)}`);
  return lines.join("\n");
}

async function callJSON({ system, user }) {
  const raw = ANTHROPIC_KEY && !OPENAI_KEY
    ? await callClaude({ system, user })
    : await callOpenAI({ system, user });
  return parseJSON(raw);
}

async function callOpenAI({ system, user }) {
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY missing");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 1200,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.choices?.[0]?.message?.content || "";
}

async function callClaude({ system, user }) {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY missing");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system,
      messages: [{ role: "user", content: user + "\n\nReturn ONLY valid JSON." }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return (json.content || []).map((c) => c.text).filter(Boolean).join("\n");
}

function parseJSON(raw) {
  if (!raw) throw new Error("empty AI response");
  // tolerate fenced code blocks
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = m ? m[1] : raw;
  try {
    return JSON.parse(body);
  } catch {
    // try to extract the first {...} block
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(body.slice(start, end + 1));
    throw new Error("AI returned non-JSON: " + body.slice(0, 200));
  }
}

module.exports = { planTask, explainFailure, summarizeDiff };
