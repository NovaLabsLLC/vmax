/**
 * Pill / freeform routing: classify which local agent should run — no LLM.
 *
 * Order matters:
 *   1) Explicit mentions (hands vs voice typos friendly)
 *   2) Obvious repo-wide / infra / migrations / meta-tooling (incl. routing heuristics,
 *      electron/ipc work, repo-wide lint) → Claude (before local-edit heuristics)
 *   3) Local Cursor edit scope (verbs + paths / Composer-style refs)
 *   4) Read-only investigate / explain / locate → Codex
 *   5) Claude default (agentic fallback)
 */

const FILE_EXT_FRAGMENT = String.raw`(?:tsx?|mts|cts|cjs|mjs|jsx?|pyi?|go|rs|java|cs|cpp|cc|c|h|hh|rb|php|swift|kt|kts|mdx?|jsonc?|ya?ml|css|s[ac]ss|html?|graphql|gql|prisma|vue|svelte|toml|ini|sh|bash|zsh|dockerfile|gradle|kts)\b`;

/** Verbs that usually mean “touch this file / selection”, not whole-repo agentics. */
const EDIT_VERBS =
  /\b(edit|rename|refactor|inline|extract|move|delete|remove|replace|change|update|modify|fix|patch|tweak|insert|append|shorten|lengthen|unwrap|hoist|dedupe|simplify|split|merge)\b/;

/** Reference to a concrete file, @ path, or editor anchor. */
const LOCAL_CODE_REF = new RegExp(
  String.raw`(?:` +
    String.raw`\b(?:in|inside|within|on|at)\s+@?[\w./-]+\.` +
    FILE_EXT_FRAGMENT +
    String.raw`|` +
    String.raw`@[\w./-]+|` +
    String.raw`\b(?:src|lib|app|tests?|test|__tests__|packages?|apps?)\/[\w./-]+\.` +
    FILE_EXT_FRAGMENT +
    String.raw`|` +
    String.raw`\bthis\s+(?:file|function|component|method|class|line|block|hook|test)\b|` +
    String.raw`\bline\s*(?:#|no\.?)?\s*\d+|` +
    String.raw`\b(?:in|on|at|inside|within)\s+(?:[\w./-]+\/)*[\w.-]*(?:dockerfile|makefile|gemfile)\b` +
    String.raw`)`,
  "i",
);

function normalize(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function matchExplicitAgent(t) {
  if (/\b(?:open|launch|paste)\s+(?:in|into|with)\s+cursor\b/.test(t)) {
    return { agent: "cursor", reason: "explicit: cursor" };
  }
  if (/\bclaude\s+code\b/.test(t) && /\b(?:please|now|go|run|start)\b/.test(t)) {
    return { agent: "claude", reason: "explicit: claude code" };
  }
  if (/\b(?:run|use)\s+claude\b/.test(t)) return { agent: "claude", reason: "explicit: claude" };
  if (/\b(?:run|use)\s+codex\b/.test(t)) return { agent: "codex", reason: "explicit: codex" };

  const patterns = [
    /\b(?:use|via|with|on|send\s+to|run\s+(?:with|on|through|in)|ask|tell|give\s+(?:it\s+)?to|route\s+(?:through|via)|hand(?:\s*[-–])?off\s+to)\s+(cursor|claude(?:\s+code)?|codex)\b/,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (!m) continue;
    const raw = ((m[1] || "").replace(/\s+/g, " ").trim()).toLowerCase();
    if (raw.includes("cursor")) return { agent: "cursor", reason: "explicit routing" };
    if (raw.includes("codex")) return { agent: "codex", reason: "explicit routing" };
    if (raw.includes("claude")) return { agent: "claude", reason: "explicit routing" };
  }
  return null;
}

/** Multi-file / infra / migrations — Claude Code excels here; route before skimmy Q&A. */
function preferClaudeRepoWork(t) {
  const signals = [
    /\b(ci|pipeline|github actions|gitlab ci|jenkins|circle\s*ci)\b.*\b(fix|repair|wire|configure|green|unblock)\b|\b(fix|repair|configure)\b.*\b(ci|pipeline)\b/i,
    /\b(prisma|knex|sequelize|typeorm|drizzle)\b.*\b(migrate|migrations?|migrating|schema|client|generate|db\s+push)\b/i,
    /\b(liquibase|flyway)\b.*\b(migrate|migrations?|migrating|changeset|script)\b|\b(run|execute)\s+.*\b(liquibase|flyway)\b/i,
    /\b(docker|dockerfile|docker\s*-?\s*compose|kubernetes|\bk8s\b|helm|terraform|pulumi)\b.*\b(write|fix|create|update|add|deploy|configure|provision|compose)\b|\b(write|fix|create|update|add)\b.*\b(dockerfile|docker\s+compose|kubernetes|k8s|helm|terraform|pulumi)\b/i,
    /\b(monorepo|pnpm\s+workspace|\burbo\b|\bnx\b|\blerna\b)\b.*\b(add|wire|migrate|upgrade|extract|configure)\b/i,
    /\b(test suite|coverage|vitest|jest|playwright|cypress|pytest|rspec)\b.*\b(fix|bring back|bring up|stabilize|add|restore)\b/i,
    /\b(search|grep|scan)\s+.{0,40}\band\s+(then\s+)?(replace|rewrite|rename|modernize)\b/i,
    /\band\s+then\b.*\b(test|deploy|migrate|publish|release|merge|commit|docker|helm|kubectl)\b/i,
    /\b(codebase|entire\s+repo|whole\s+repo|across\s+(?:the\s+)?repo|throughout\s+(?:the\s+)?(codebase|project))\b.*\b(refactor|migrate|upgrade|rename|modularize|instrument)\b/i,
    /\b(refactor|restructure)\b.*\b(architecture|auth|payments|infra|services?|everywhere)\b/i,
    /\b(implement|ship|deploy|scaffold)\b.*\b((?:multi|several|multiple)\s+\w+|microservice|monolith|system)\b/i,
    /\b(open|create|merge)\s+(?:a\s+)?pull\s+request\b|\bprep(?:are)?\s+(?:a\s+)?pr\b/i,
    /\b(heuristic|classification|intent\s+engine|pill\s+routing|routing\s+logic)\b[\s\S]{0,72}\b(weak|bad|accuracy|effective|benchmark|rewrite|audit|solid|strengthen)\b|\b(improve|strengthen|rewrite|benchmark|optimize|audit|investigate)\b[\s\S]{0,72}\b(heuristic|intent\s+engine|router|routing|pill|dispatcher|classifier)s?\b/i,
    /\b(audit|survey|investigate|map\s+out|inventory)\b[\s\S]{0,52}\b(codebase|entire\s+codebase|whole\s+repo|project|routing|intent|architecture)\b|\b(codebase|entire\s+codebase|whole\s+repo)\b[\s\S]{0,40}\b(audit|survey|inventory)\b/i,
    /\belectron\/(ipc|utils)\b[\s\S]{0,80}\b(fix|implement|rewrite|audit|touch|extend|refactor|preload|dispatch|routing)s?\b|\b(fix|improve|implement|rewrite|audit|routing)\b[\s\S]{0,80}\belectron\/(ipc|utils)\b/i,
    /\b(fix|improve|implement|rewrite|audit|refactor|touch|extend)\b[\s\S]{0,48}\bagentintent\.js\b|\bagentintent\.js\b[\s\S]{0,48}\b(fix|improve|implement|rewrite|audit|refactor|extend)\b|\b(fix|improve|implement|rewrite|audit)\b[\s\S]{0,40}\bipc\/dispatch\b|\bipc\/dispatch\b[\s\S]{0,40}\b(fix|implement|rewrite|audit)\b/i,
    /\b(lint|eslint|prettier|typecheck)\b[\s\S]{0,36}\b(across|everywhere|whole\s+repo|codebase)\b|\bacross\s+(?:the\s+)?repo\b[\s\S]{0,36}\b(lint|eslint|prettier|typecheck)\b|\b(ci\s+noise|warnings?)\b[\s\S]{0,40}\b(repo|suite|build)\b/i,
  ];
  if (signals.some((re) => re.test(t))) {
    return { agent: "claude", reason: "repo / infra / multi-step work" };
  }
  return null;
}

function looksLikeCursorScopedEdit(t) {
  if (!EDIT_VERBS.test(t)) return false;
  if (!LOCAL_CODE_REF.test(t)) return false;
  return true;
}

/**
 * Read-only / investigation — Codex; blocked when user clearly wants implementation.
 */
const IMPL_BLOCKER =
  /\b(implement|scaffold|set\s+up|wire\s+up|ship|deploy|migrat(?:e|ion|ing)|prisma\s+migrate|db\s+push|kubectl|helm\s+install|terraform\s+apply|release\s+to|npm\s+publish|yarn\s+release|open\s+(?:a\s+)?pr|create\s+(?:a\s+)?pr|submit\s+(?:a\s+)?pr)\b/;

const HOW_BUILD = /\bhow\s+(?:do|should|can)\s+i\s+(?:build|implement|create|ship|deploy|migrate)\b/;

/** Informational question / navigation — Codex-first when not blocked above. */
function readOrLocateShape(t) {
  if (
    /\b(explain|describe|summarize|outline|compare|contrast|clarify|define|interpret|meaning|purpose|difference\s+between)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(walk\s+through|break\s+down|help\s+me\s+understand|can\s+you\s+explain|looking\s+for|point\s+me\s+to)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/\b(find|search|grep|locate|look\s+for|navigate\s+to|jump\s+to|which\s+file|audit|trace)\b/i.test(t)) {
    return true;
  }
  if (
    /\b(is\s+there|are\s+there)\b/i.test(t)
    || /\bwhere\b/i.test(t)
    || /\b(what|why|when|who)\b/i.test(t)
  ) {
    return true;
  }
  if (/\blist\b/i.test(t) && /\b(files?|symbols?|exports?|endpoints?|routes?|tests?)\b/i.test(t)) {
    return true;
  }
  if (/\b(show|tell)\s+me\b/i.test(t)) {
    return true;
  }
  // "How does X work" but not "how do I build…"
  if (/\bhow\b/i.test(t) && !/\bhow\s+(?:do|should|can)\s+i\b/i.test(t)) {
    return true;
  }
  // Code review read-only; "review X and fix" handled by IMPL / Claude default
  if (/\breview\b/i.test(t) && !/\b(fix|patch|implement|address|apply)\b/i.test(t)) {
    return true;
  }
  return false;
}

function looksLikeQuickReadOnlyQa(t) {
  if (IMPL_BLOCKER.test(t)) return false;
  if (HOW_BUILD.test(t)) return false;
  if (!readOrLocateShape(t)) return false;
  return true;
}

/**
 * @param {string} rawPrompt
 * @returns {{ agent: 'claude'|'codex'|'cursor', reason: string }}
 */
function routeAgentIntent(rawPrompt) {
  const t = normalize(rawPrompt);
  if (!t) return { agent: "claude", reason: "empty → default" };

  const ex = matchExplicitAgent(t);
  if (ex) return ex;

  const claudePrefer = preferClaudeRepoWork(t);
  if (claudePrefer) return claudePrefer;

  if (looksLikeCursorScopedEdit(t)) {
    return { agent: "cursor", reason: "in-editor / local file edit" };
  }

  if (looksLikeQuickReadOnlyQa(t)) {
    return { agent: "codex", reason: "read-only / locate / explain" };
  }

  return { agent: "claude", reason: "default agentic fallback" };
}

module.exports = { routeAgentIntent, normalize };

if (typeof require !== "undefined" && require.main === module) {
  const assert = require("assert");
  const { routeAgentIntent: route } = module.exports;
  const cases = [
    ["improve the intent engine for pill routing", "claude"],
    ["audit routing heuristics across the codebase", "claude"],
    ["fix agentintent.js and dispatch ipc", "claude"],
    ["explain how routeAgentIntent works", "codex"],
    ["edit src/foo.ts and fix the typo", "cursor"],
    ["grep for TODO and then rename symbols", "claude"],
    ["fix prisma migrate shadow database error", "claude"],
  ];
  for (const [prompt, want] of cases) {
    const got = route(prompt).agent;
    assert.strictEqual(
      got,
      want,
      `route(${JSON.stringify(prompt)}): expected ${want}, got ${got}`,
    );
  }
  console.log("agentIntent self-test ok (%d cases)", cases.length);
}
