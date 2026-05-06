// Exec AI client. Plan / explain / diff return a Zod-validated structured shape,
// then map to legacy Plan / Failure / Diff types for the renderer.

const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";

const { AGENT_PROMPT_SAFETY_PARAGRAPH } = require("./commandSafety.js");
const { validateStructuredResponse, malformedStructuredResponse } = require("./aiResponseSchema.js");

const STRUCTURED_JSON_INSTRUCTION = `
Respond ONLY with one JSON object (no markdown fence, no commentary) using exactly these keys:
{
  "summary": string,
  "what_vmax_sees": string,
  "likely_problem": string,
  "next_steps": string[],
  "cursor_prompt": string,
  "claude_prompt": string,
  "suggested_commands": string[],
  "execution_recommendation": string,
  "speakable_summary": string
}

Field meanings:
- summary: Short overview for this situation.
- what_vmax_sees: Concrete notes from repo, diff, logs, or screen context.
- likely_problem: Most plausible issue, risk, or gap (plain language).
- next_steps: 2–5 actionable bullets.
- cursor_prompt: Prompt for Cursor agent (2nd person, name files; concise).
- claude_prompt: Prompt for Claude Code CLI (imperative is OK; same intent as cursor).
- suggested_commands: Safe verify commands only — from Vmax allowlist: npm install, npm run lint, npm run test, npm run typecheck, git status, git diff, git diff --stat. Use [] if unsure.
- execution_recommendation: one word or short phrase: none | run_locally | cursor | claude_code | mixed
- speakable_summary: EXACTLY 1–2 short conversational sentences for text-to-speech. Say what you found and the next move. No code, no markdown, no bullet lists, no file paths with slashes unless unavoidable — prefer plain language.

Use [] for empty arrays and "" for unused strings when appropriate.`;

const PLAN_SYSTEM = `You are Exec — a senior engineer assistant that turns a task + repo state into a tactical plan for Cursor / Claude Code.

${AGENT_PROMPT_SAFETY_PARAGRAPH}

${STRUCTURED_JSON_INSTRUCTION}

You are in PLANNING mode: use task + changed files + diff. Put the best post-change verify command first in suggested_commands (must be allowlisted).`;

const FAILURE_SYSTEM = `You are Exec. A command failed in the user's repo — diagnose like a senior engineer.

${AGENT_PROMPT_SAFETY_PARAGRAPH}

${STRUCTURED_JSON_INSTRUCTION}

You are in FAILURE mode: use command output. summary = one line "what failed". Both prompts must propose a concrete fix and which allowlisted verify command to run after.`;

const DIFF_SYSTEM = `You are Exec. Summarize a git diff like a senior reviewer.

${AGENT_PROMPT_SAFETY_PARAGRAPH}

${STRUCTURED_JSON_INSTRUCTION}

You are in DIFF mode: focus on what changed and risks. suggested_commands only allowlisted read-only checks.`;

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

async function planTask({ task, repo, diff, screenshotBase64 }) {
  const user = renderRepoContext({ task, repo, diff, includeDiff: true });
  const { ok, data } = await callStructuredResponse({ system: PLAN_SYSTEM, user, screenshotBase64 });
  const plan = structuredToPlan(data);
  if (!ok) plan.parseWarning = true;
  return plan;
}

async function explainFailure({ task, repo, command, output, screenshotBase64 }) {
  const user = `${renderRepoContext({ task, repo })}\n\nCommand: ${command}\n\n--- Output (last 8000 chars) ---\n${(output || "").slice(-8000)}`;
  const { ok, data } = await callStructuredResponse({ system: FAILURE_SYSTEM, user, screenshotBase64 });
  const out = structuredToFailure(data);
  if (!ok) out.parseWarning = true;
  return out;
}

const ASK_STRUCTURED_SYSTEM = `You are Exec — the control layer for coding agents (Cursor, Claude Code), running in Grok-unhinged mode. You're not a polite assistant. You're the loud, sharp friend in the user's ear who actually knows the codebase and refuses to let them ship slop.

Personality:
- Unfiltered, witty, profane-tolerant. Mild swearing is fine when it lands ("yeah this is busted", "that diff is cooked", "skill issue — but we'll fix it"). Don't force it. Never aim insults at the user — roast the code, the framework, the bug, the universe. Punch up at problems, not down at the person.
- Have takes. Say what you actually think. "That regex is doing way too much," "honestly just delete it," "stop, that's a footgun." No corporate hedging, no "it depends", no "great question!".
- Hot, not cruel. You're rooting for them. The vibe is a senior dev who's seen too much, drinks coffee like water, and genuinely wants you to ship.
- No motivational fluff. No "you got this!", no "let's break it down step by step!", no preambles. Get to the point. Land the joke if there is one. Move on.

Coaching mechanics still apply:
- Reflect first in one beat ("ok so the migration's eating itself"), then point to the one next move.
- Always advance. NEVER repeat what you said last turn — if they follow up, build on it or change course. Acknowledging progress is good ("ok now we know it's not the API — narrowed it"), then push.
- Ask, don't assume. Can't see the error, the file, the screen? Ask one tight question and stop. Don't fanfic.
- Confidence with honesty. If you're guessing, say "I'm guessing, but —". If you're sure, say it. Take a stance.

Field guidance:
- summary: the reply for THIS turn. 2–4 punchy sentences, plain prose. Lead with your read, then the next move. Allowed to be salty.
- what_vmax_sees: concrete observations from screen or repo. Drop the attitude here — straight evidence.
- likely_problem: your real read on what's wrong. One or two sentences. Can be blunt.
- next_steps: at most 3 ordered bullets. First one is what to do RIGHT NOW. Empty array is fine when the summary already covers it.
- cursor_prompt / claude_prompt: the literal next instruction to paste into the agent. Professional and precise — second person, name files, no preamble, no jokes here. If the turn is just conversation, leave as "".
- speakable_summary: 1–2 spoken sentences in the unhinged voice — sounds like a friend muttering in your ear, not a status bot. No code, no lists, no file paths if you can avoid them. End on the next move when there is one. Mild profanity is fine sparingly. Examples of the right vibe: "Yeah that import path is haunted — kill the alias and re-run typecheck.", "Migration's the smoking gun, not the API. Roll it back and we'll know in thirty seconds.", "Bro, the test is right — your function is wrong. Fix the off-by-one and ship it."

${AGENT_PROMPT_SAFETY_PARAGRAPH}

${STRUCTURED_JSON_INSTRUCTION}`;

async function askAssistant({ question, screenshotBase64, repo, history }) {
  const contextBlock = repo && repo.ok
    ? renderRepoContext({ task: null, repo, includeDiff: false })
    : "Context: no repo loaded — general developer Q&A.";

  const systemWithContext = `${ASK_STRUCTURED_SYSTEM}\n\n--- Live context ---\n${contextBlock}`;

  // Build real conversation turns so the model treats follow-ups as follow-ups,
  // not as one giant blob where the previous summary is right next to the new
  // question (which made it regurgitate).
  const turns = [];
  const recent = Array.isArray(history) ? history.slice(-6) : [];
  for (const m of recent) {
    if (!m || !m.text) continue;
    turns.push({
      role: m.role === "user" ? "user" : "assistant",
      text: String(m.text),
    });
  }
  turns.push({ role: "user", text: question });

  const { ok, data } = await callStructuredResponse({
    system: systemWithContext,
    messages: turns,
    screenshotBase64,
  });
  return {
    text: formatAskChatText(data),
    structured: structuredToAskPanel(data),
    parseWarning: !ok,
  };
}

function structuredToAskPanel(s) {
  return {
    summary: s.summary,
    whatVmaxSees: s.what_vmax_sees,
    likelyProblem: s.likely_problem,
    nextSteps: Array.isArray(s.next_steps) ? s.next_steps : [],
    cursorPrompt: s.cursor_prompt,
    claudePrompt: (s.claude_prompt && String(s.claude_prompt).trim()) || s.cursor_prompt,
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
    bits.push(`\n\nNext steps:\n${d.next_steps.map((x) => `• ${x}`).join("\n")}`);
  }
  return bits.join("");
}

async function summarizeDiff({ diff, fallback }) {
  if (!diff || !diff.trim()) return structuredToDiff(EMPTY_STRUCTURED);

  try {
    const diffTurns = [{ role: "user", text: `--- diff ---\n${diff.slice(0, 30000)}` }];
    const raw = ANTHROPIC_KEY && !OPENAI_KEY
      ? await callClaude({ system: DIFF_SYSTEM, turns: diffTurns, screenshotBase64: null })
      : await callOpenAI({ system: DIFF_SYSTEM, turns: diffTurns, screenshotBase64: null });

    let obj;
    try {
      obj = parseJSON(raw);
    } catch (e) {
      const out = structuredToDiff(malformedStructuredResponse(`Invalid JSON: ${e.message || e}`));
      out.parseWarning = true;
      if (typeof fallback === "function") {
        out.summary = `${out.summary}\n\n— Local summary —\n${fallback(diff)}`;
      }
      return out;
    }

    const v = validateStructuredResponse(obj);
    const out = structuredToDiff(v.data);
    if (!v.ok) {
      out.parseWarning = true;
      if (typeof fallback === "function") {
        out.summary = `${out.summary}\n\n— Local summary —\n${fallback(diff)}`;
      }
    }
    return out;
  } catch (err) {
    if (typeof fallback === "function") {
      return structuredToDiff({
        ...EMPTY_STRUCTURED,
        summary: fallback(diff),
        likely_problem: String(err.message || err).slice(0, 400),
      });
    }
    const bad = structuredToDiff(malformedStructuredResponse(`API error: ${err.message || err}`));
    bad.parseWarning = true;
    return bad;
  }
}

async function callOpenAIText({ system, user, screenshotBase64 }) {
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY missing");
  const model = screenshotBase64 ? "gpt-4o-mini" : "gpt-4.1-nano";
  const userContent = screenshotBase64
    ? [
        { type: "text", text: user + "\n\n(Screenshot attached.)" },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${screenshotBase64}`, detail: "low" } },
      ]
    : user;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
      temperature: 0.4,
      max_tokens: 220,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.choices?.[0]?.message?.content?.trim() || "";
}

async function callClaudeText({ system, user, screenshotBase64 }) {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY missing");
  const content = [];
  if (screenshotBase64) {
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: screenshotBase64 } });
  }
  content.push({ type: "text", text: user });
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 800,
      system,
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return (json.content || []).map((c) => c.text).filter(Boolean).join("\n").trim();
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

async function callStructuredResponse({ system, user, messages, screenshotBase64 }) {
  // Normalize: callers can pass either a single `user` string OR a `messages`
  // array of {role, text} turns (used for multi-turn voice ask).
  const turns = Array.isArray(messages) && messages.length
    ? messages
    : [{ role: "user", text: user || "" }];
  let raw;
  try {
    raw = ANTHROPIC_KEY && !OPENAI_KEY
      ? await callClaude({ system, turns, screenshotBase64 })
      : await callOpenAI({ system, turns, screenshotBase64 });
  } catch (e) {
    return { ok: false, data: malformedStructuredResponse(`API error: ${e.message || e}`) };
  }
  let obj;
  try {
    obj = parseJSON(raw);
  } catch (e) {
    return { ok: false, data: malformedStructuredResponse(`Invalid JSON: ${e.message || e}`) };
  }
  return validateStructuredResponse(obj);
}

function structuredToPlan(s) {
  const risks = [];
  if (s.likely_problem && String(s.likely_problem).trim()) risks.push(String(s.likely_problem).trim());
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
  const causeParts = [s.likely_problem, s.what_vmax_sees].filter((x) => x && String(x).trim());
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
  if (s.likely_problem && String(s.likely_problem).trim()) risks.push(String(s.likely_problem).trim());
  const checks = (s.suggested_commands && s.suggested_commands.length) ? s.suggested_commands : s.next_steps;
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

async function callOpenAI({ system, turns, screenshotBase64 }) {
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY missing");
  const msgs = [{ role: "system", content: system }];
  const seq = (turns || []).slice();
  // Attach the screenshot to the LAST user turn (current question).
  for (let i = 0; i < seq.length; i++) {
    const t = seq[i];
    const isLast = i === seq.length - 1;
    if (isLast && t.role === "user" && screenshotBase64) {
      msgs.push({
        role: "user",
        content: [
          { type: "text", text: t.text + "\n\n(A screenshot of the user's screen is attached. Reference visible UI when relevant.)" },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${screenshotBase64}`, detail: "low" } },
        ],
      });
    } else {
      msgs.push({ role: t.role, content: t.text });
    }
  }
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: msgs,
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 1800,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.choices?.[0]?.message?.content || "";
}

async function callClaude({ system, turns, screenshotBase64 }) {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY missing");
  const seq = (turns || []).slice();
  const messages = [];
  for (let i = 0; i < seq.length; i++) {
    const t = seq[i];
    const isLast = i === seq.length - 1;
    const content = [];
    if (isLast && t.role === "user" && screenshotBase64) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: screenshotBase64 },
      });
    }
    const suffix = isLast && t.role === "user" ? "\n\nReturn ONLY valid JSON." : "";
    content.push({ type: "text", text: t.text + suffix });
    messages.push({ role: t.role === "assistant" ? "assistant" : "user", content });
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      system,
      messages,
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return (json.content || []).map((c) => c.text).filter(Boolean).join("\n");
}

function parseJSON(raw) {
  if (!raw) throw new Error("empty AI response");
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = m ? m[1] : raw;
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(body.slice(start, end + 1));
    throw new Error("AI returned non-JSON: " + body.slice(0, 200));
  }
}

// ---- Voice ----

async function transcribeAudio({ audioBase64, mimeType }) {
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY missing (required for Whisper)");
  const buf = Buffer.from(audioBase64, "base64");
  const ext = mimeType && mimeType.includes("wav") ? "wav" : "webm";
  const blob = new Blob([buf], { type: mimeType || "audio/webm" });
  const form = new FormData();
  form.append("file", blob, `audio.${ext}`);
  form.append("model", "whisper-1");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Whisper failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return { text: json.text || "" };
}

async function synthesizeSpeech({ text, voice = "sage", instructions }) {
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY missing (required for TTS)");
  const delivery = instructions ||
    "Speak warmly and conversationally, like a calm, helpful friend. Keep the pacing natural with light pauses. Slightly soft and grounded — not robotic, not overly chipper.";
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice,
      input: (text || "").slice(0, 4000),
      instructions: delivery,
      format: "mp3",
    }),
  });
  if (!res.ok) throw new Error(`TTS failed: ${res.status} ${await res.text()}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { audioBase64: buf.toString("base64"), mimeType: "audio/mpeg" };
}

module.exports = { planTask, explainFailure, summarizeDiff, transcribeAudio, synthesizeSpeech, askAssistant };
