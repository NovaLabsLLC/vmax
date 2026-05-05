/**
 * Vmax demo: only a small allowlist of commands may run in the selected repo.
 * Not a security boundary (shell is still shell: true).
 */

const ALLOWLIST_SUMMARY =
  "npm install, npm run lint, npm run test, npm run typecheck, git status, git diff, git diff --stat";

const AGENT_PROMPT_SAFETY_PARAGRAPH = `Hard safety rules (Vmax demo — Cursor, Claude Code, OpenClaw, etc.): The app only runs this exact allowlist in the UI shell: ${ALLOWLIST_SUMMARY}. Do not suggest any other shell command for the automated runner. Do not instruct production deploys, force pushes, git reset/clean that drops work, secret dumps (printenv, .env cats, private keys), or file deletion without explicit human approval.`;

const CURSOR_CLIPBOARD_SAFETY_FOOTER = `

---
**Vmax demo safety:** In this environment only these repo commands may run: ${ALLOWLIST_SUMMARY}. No deploys, no secret dumps, no \`git reset\`/\`git clean -fd\`/\`rm -rf\`/\`git push --force\`.`;

/** Exit code when a command is blocked by policy (not OS error). */
const EXIT_POLICY_BLOCK = 125;

/** Patterns that must always be rejected (defense in depth). */
const HARD_BLOCKS = [
  [/rm\s+[^\n]*-\w*rf\b/i, "rm -rf is not allowed in Vmax."],
  [/git\s+reset\s+--hard\b/i, "git reset --hard is not allowed in Vmax."],
  [/git\s+clean\s+-fd\b/i, "git clean -fd is not allowed in Vmax."],
  [/git\s+push\s+[^\n]*--force\b/i, "git push --force is not allowed in Vmax."],
  [/\bgit\s+push\b[^\n#]*(?:\s-f\b|\s+-\s*f\b)/i, "git push -f is not allowed in Vmax."],
];

/** Only these forms match after normalization (single line, collapsed spaces, trimmed). */
const ALLOWED_REGEX = [
  // npm install [flags and package names; no shell metacharacters — filtered earlier]
  /^npm install(?:\s+[-\w@./^~>=<:*]+)*$/i,
  /^npm run lint$/i,
  /^npm run test$/i,
  /^npm run typecheck$/i,
  /^git status$/i,
  /^git diff$/i,
  /^git diff --stat$/i,
];

function hasShellInjection(cmd) {
  if (/[\n\r]/.test(cmd)) return true;
  if (/[;&|]/.test(cmd)) return true;
  if (/&&|\|\||`|\$\(/.test(cmd)) return true;
  if (/[<>]/.test(cmd)) return true;
  return false;
}

function hasEnvPrefix(cmd) {
  return /^\s*[A-Za-z_][A-Za-z0-9_]*=/.test(cmd);
}

/** Commands likely intended to dump or probe secrets. */
function looksLikeSecretProbe(cmd) {
  const c = cmd;
  const low = c.toLowerCase();
  const patterns = [
    /\bprintenv\b/i,
    /^env\s/i,
    /\bcat\s+[^\n]*\.env\b/i,
    /\btype\s+[^\n]*\.env\b/i,
    /\bless\s+[^\n]*\.env\b/i,
    /\.ssh\b/i,
    /\bid_rsa\b/i,
    /\.pem\b/i,
    /begin\s+(?:rsa\s+)?private\s+key/i,
    /\baws\s+secretsmanager\b/i,
    /\baws\s+ssm\s+get-parameter\b/i,
    /\bgcloud\s+secrets\b/i,
    /\bkubectl\s+get\s+secret\b/i,
    /\bvault\s+read\b/i,
    /\bpassword\s*[:=]/i,
    /\bapi[_-]?key\s*[:=]/i,
    /bearer\s+[a-z0-9+/=_-]{20,}/i,
    /sk-[a-z0-9]{10,}/i, // common API key prefix pattern in examples
  ];
  return patterns.some((p) => p.test(c) || p.test(low));
}

/**
 * @param {string} rawCommand
 * @returns {string | null} Human-readable block reason, or null if allowed.
 */
function getCommandBlockReason(rawCommand) {
  const cmd = String(rawCommand || "").trim();
  if (!cmd) return "Empty command.";

  const c = cmd.replace(/\s+/g, " ").trim();

  if (hasShellInjection(c)) {
    return "Only one simple command is allowed — no |, &&, ;, newlines, redirects, or $(…)/`…`.";
  }
  if (hasEnvPrefix(c)) {
    return "Prefixing commands with environment variables (FOO=bar …) is not allowed in Vmax.";
  }
  if (/\bdeploy\b/i.test(c)) {
    return "Deploy commands are not allowed in Vmax.";
  }
  if (looksLikeSecretProbe(c)) {
    return "Commands that may expose secrets (env dumps, keys, credential files) are not allowed in Vmax.";
  }

  for (const [re, msg] of HARD_BLOCKS) {
    if (re.test(c)) return msg;
  }

  for (const re of ALLOWED_REGEX) {
    if (re.test(c)) return null;
  }

  return `Not on the Vmax allowlist. Allowed: ${ALLOWLIST_SUMMARY}.`;
}

module.exports = {
  getCommandBlockReason,
  AGENT_PROMPT_SAFETY_PARAGRAPH,
  CURSOR_CLIPBOARD_SAFETY_FOOTER,
  EXIT_POLICY_BLOCK,
  ALLOWLIST_SUMMARY,
};
