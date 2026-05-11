// Vmax AI client.
//
// Hard cutover: this file is now a thin HTTP client to the FastAPI
// backend in ./backend. No OpenAI / Anthropic keys live on the desktop
// app anymore — the server in backend/ owns them. The exported functions
// keep the same names + return shapes the renderer expects, so callers in
// electron/ipc/ai.js don't need to change.
//
// Pipeline for the structured assistant routes (/ask, /plan,
// /explain-failure, /summarize-diff):
//   client → POST snake_case body → backend calls LLM → backend returns
//   { structured: <StructuredResponse>, parse_warning: bool } → client
//   maps that into the legacy Plan / Failure / Diff / AskPanel shape.

const BACKEND_URL =
  (process.env.VMAX_BACKEND_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");

const REQUEST_TIMEOUT_MS = 60_000;

const EMPTY_STRUCTURED = {
  summary: "(no diff)",
  what_vmax_sees: "",
  likely_problem: "",
  next_steps: [],
  cursor_prompt: "",
  claude_prompt: "",
  suggested_commands: [],
  execution_recommendation: "none",
  speakable_summary: "",
};

// ---- HTTP plumbing ----

async function requestJson(path, body) {
  const url = `${BACKEND_URL}${path}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(`Vmax backend unreachable at ${BACKEND_URL}: ${err.message || err}`);
  }
  clearTimeout(timer);

  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      detail = j?.detail || JSON.stringify(j);
    } catch {
      try { detail = await res.text(); } catch { /* ignore */ }
    }
    throw new Error(`Vmax backend ${res.status}: ${detail || res.statusText}`);
  }
  return res.json();
}

function normalizeStructured(raw) {
  // The backend always sends a complete StructuredResponse, but be
  // defensive: if a future server returns extra keys or omits one, fall
  // back to the empty shape for missing fields.
  const s = raw || {};
  return {
    summary: s.summary || "",
    what_vmax_sees: s.what_vmax_sees || "",
    likely_problem: s.likely_problem || "",
    next_steps: Array.isArray(s.next_steps) ? s.next_steps : [],
    cursor_prompt: s.cursor_prompt || "",
    claude_prompt: s.claude_prompt || "",
    suggested_commands: Array.isArray(s.suggested_commands) ? s.suggested_commands : [],
    execution_recommendation: s.execution_recommendation || "none",
    speakable_summary: s.speakable_summary || "",
  };
}

// ---- Structured → UI shape mappers (kept on the client; the renderer
// expects these exact field names and shapes). ----

function structuredToPlan(s) {
  const risks = [];
  if (s.likely_problem && String(s.likely_problem).trim()) {
    risks.push(String(s.likely_problem).trim());
  }
  for (const step of s.next_steps || []) {
    if (risks.length >= 8) break;
    const t = String(step || "").trim();
    if (t && !risks.includes(t)) risks.push(t);
  }
  const cmd = (s.suggested_commands && s.suggested_commands[0]) || "";
  return {
    summary: s.summary,
    files: [],
    risks,
    command: cmd,
    cursorPrompt: s.cursor_prompt,
    claudePrompt: (s.claude_prompt && s.claude_prompt.trim()) || s.cursor_prompt,
    whatVmaxSees: s.what_vmax_sees,
    nextStepsStructured: s.next_steps,
    executionRecommendation: s.execution_recommendation,
    speakableSummary: s.speakable_summary,
  };
}

function structuredToFailure(s) {
  const causeParts = [s.likely_problem, s.what_vmax_sees].filter(
    (x) => x && String(x).trim(),
  );
  return {
    what: s.summary,
    likelyFile: null,
    cause: causeParts.join("\n\n").trim() || s.summary,
    next: s.next_steps,
    cursorPrompt: s.cursor_prompt,
    claudePrompt: (s.claude_prompt && s.claude_prompt.trim()) || s.cursor_prompt,
    whatVmaxSees: s.what_vmax_sees,
    suggestedCommands: s.suggested_commands,
    executionRecommendation: s.execution_recommendation,
    speakableSummary: s.speakable_summary,
  };
}

function structuredToDiff(s) {
  const risks = [];
  if (s.likely_problem && String(s.likely_problem).trim()) {
    risks.push(String(s.likely_problem).trim());
  }
  const checks =
    s.suggested_commands && s.suggested_commands.length
      ? s.suggested_commands
      : s.next_steps;
  return {
    summary: s.summary,
    files: [],
    risks,
    nextChecks: checks,
    cursorPrompt: s.cursor_prompt,
    claudePrompt: (s.claude_prompt && s.claude_prompt.trim()) || s.cursor_prompt,
    whatVmaxSees: s.what_vmax_sees,
    nextStepsStructured: s.next_steps,
    executionRecommendation: s.execution_recommendation,
    speakableSummary: s.speakable_summary,
  };
}

function structuredToAskPanel(s) {
  return {
    summary: s.summary,
    whatVmaxSees: s.what_vmax_sees,
    likelyProblem: s.likely_problem,
    nextSteps: Array.isArray(s.next_steps)
      ? s.next_steps.map((x) => String(x || "").trim()).filter(Boolean)
      : [],
    cursorPrompt: s.cursor_prompt,
    claudePrompt:
      (s.claude_prompt && String(s.claude_prompt).trim()) || s.cursor_prompt,
    suggestedCommands: Array.isArray(s.suggested_commands) ? s.suggested_commands : [],
    speakableSummary: s.speakable_summary,
    executionRecommendation: s.execution_recommendation,
  };
}

function formatAskChatText(d) {
  const bits = [d.summary];
  if (d.likely_problem && String(d.likely_problem).trim()) {
    bits.push(`\n\nLikely issue: ${String(d.likely_problem).trim()}`);
  }
  if (d.next_steps?.length) {
    bits.push(
      `\n\nNext steps:\n${d.next_steps.map((x) => `\u2022 ${x}`).join("\n")}`,
    );
  }
  return bits.join("");
}

// ---- Public API (matches the previous module exports 1:1) ----

async function planTask({ task, diff, screenshotBase64, repoContextSummary }) {
  // Optional git snapshot improves plans when diff alone is incomplete.
  const env = await requestJson("/v1/plan", {
    task: task || "",
    diff: diff || null,
    screenshot_base64: screenshotBase64 || null,
    repo_context_summary:
      repoContextSummary && String(repoContextSummary).trim()
        ? String(repoContextSummary).slice(0, 24_000)
        : null,
  });
  const data = normalizeStructured(env.structured);
  const plan = structuredToPlan(data);
  if (env.parse_warning) plan.parseWarning = true;
  return plan;
}

async function explainFailure({
  task,
  command,
  output,
  screenshotBase64,
  repoContextSummary,
}) {
  // Optional repo snapshot gives the model anchors for likely files.
  const env = await requestJson("/v1/explain-failure", {
    task: task || "",
    command: command || "",
    output: output || "",
    screenshot_base64: screenshotBase64 || null,
    repo_context_summary:
      repoContextSummary && String(repoContextSummary).trim()
        ? String(repoContextSummary).slice(0, 24_000)
        : null,
  });
  const data = normalizeStructured(env.structured);
  const out = structuredToFailure(data);
  if (env.parse_warning) out.parseWarning = true;
  return out;
}

async function summarizeDiff({ diff, fallback }) {
  if (!diff || !diff.trim()) return structuredToDiff(EMPTY_STRUCTURED);

  let env;
  try {
    env = await requestJson("/v1/summarize-diff", { diff: String(diff) });
  } catch (err) {
    // Network / 5xx — preserve the original UX: show the local fallback
    // summary if the caller provided one, alongside the error.
    if (typeof fallback === "function") {
      return structuredToDiff({
        ...EMPTY_STRUCTURED,
        summary: fallback(diff),
        likely_problem: String(err.message || err).slice(0, 400),
      });
    }
    throw err;
  }

  const data = normalizeStructured(env.structured);
  const out = structuredToDiff(data);
  if (env.parse_warning) {
    out.parseWarning = true;
    if (typeof fallback === "function") {
      out.summary = `${out.summary}\n\n\u2014 Local summary \u2014\n${fallback(diff)}`;
    }
  }
  return out;
}

async function askAssistant({
  question,
  screenshotBase64,
  history,
  repoContextSummary,
}) {
  const cleanedHistory = Array.isArray(history)
    ? history
        .filter((m) => m && m.text)
        .map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          text: String(m.text),
        }))
    : [];

  const env = await requestJson("/v1/ask", {
    question: String(question || ""),
    screenshot_base64: screenshotBase64 || null,
    history: cleanedHistory,
    repo_context_summary:
      repoContextSummary && String(repoContextSummary).trim()
        ? String(repoContextSummary).slice(0, 24_000)
        : null,
  });

  const data = normalizeStructured(env.structured);
  return {
    text: formatAskChatText(data),
    structured: structuredToAskPanel(data),
    parseWarning: !!env.parse_warning,
  };
}

async function transcribeAudio({ audioBase64, mimeType }) {
  const env = await requestJson("/v1/transcribe", {
    audio_base64: String(audioBase64 || ""),
    mime_type: mimeType || null,
  });
  return { text: env.text || "" };
}

async function synthesizeSpeech({ text, voice = "alloy" }) {
  const env = await requestJson("/v1/tts", {
    text: text || "",
    voice: voice || "alloy",
  });
  return {
    audioBase64: env.audio_base64 || "",
    mimeType: env.mime_type || "audio/mpeg",
  };
}

module.exports = {
  planTask,
  explainFailure,
  summarizeDiff,
  transcribeAudio,
  synthesizeSpeech,
  askAssistant,
};
