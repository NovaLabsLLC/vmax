// Context-aware commit messages for Vmax workspace quick-push (EXE-35).
// Produces conventional-commit subjects plus structured bodies so agents and
// humans can scan git history without opening every diff.

const { spawnSync } = require("child_process");

const FALLBACK_SUBJECT = "chore(vmax): workspace push from Command Center";

function spawnGit(repoPath, args) {
  return spawnSync("git", args, {
    cwd: repoPath,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    shell: false,
  });
}

/** @typedef {{ status: string, path: string }} NameStatusEntry */

/**
 * @param {string} stdout
 * @returns {NameStatusEntry[]}
 */
function parseNameStatus(stdout) {
  const out = [];
  for (const line of String(stdout || "").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split(/\t+/);
    if (parts.length < 2) continue;
    const status = parts[0].trim();
    let filePath = parts[parts.length - 1].trim();
    // Rename lines: R100\told\tnew — keep destination path
    if (parts.length >= 3 && /^R\d+$/.test(status)) {
      filePath = parts[parts.length - 1].trim();
    }
    if (filePath) out.push({ status, path: filePath.replace(/\\/g, "/") });
  }
  return out;
}

/**
 * @param {string} p
 */
function scopeFromPath(p) {
  const n = String(p || "").replace(/\\/g, "/");
  if (n.startsWith("electron/ipc/")) return "ipc";
  if (n.startsWith("electron/")) return "electron";
  if (n.startsWith("src/renderer/")) return "renderer";
  if (n.startsWith("src/")) return "src";
  if (n.startsWith("utils/")) return "utils";
  if (n.startsWith("scripts/")) return "scripts";
  if (n.startsWith("backend/")) return "backend";
  return "repo";
}

/**
 * @param {NameStatusEntry[]} entries
 */
function dominantScope(entries) {
  const tally = Object.create(null);
  for (const e of entries) {
    const s = scopeFromPath(e.path);
    tally[s] = (tally[s] || 0) + 1;
  }
  let best = "repo";
  let n = 0;
  for (const [k, v] of Object.entries(tally)) {
    if (v > n) {
      best = k;
      n = v;
    }
  }
  return best;
}

/**
 * @param {NameStatusEntry[]} entries
 */
function inferType(entries, diffSample) {
  let chore = 0;
  let test = 0;
  let docs = 0;
  let feat = 0;

  const sample = String(diffSample || "").slice(0, 6000).toLowerCase();

  for (const e of entries) {
    const pl = e.path.toLowerCase();
    if (/^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|package\.json)$/.test(pl.split("/").pop() || "")) {
      chore += 4;
    }
    if (/(\btest\b|__tests__|\.test\.|\.spec\.)/.test(pl)) test += 3;
    if (/\.md$/i.test(pl) || /(^|\/)docs?\//i.test(pl)) docs += 3;
    if (e.status.startsWith("A") || e.status === "??") feat += 1;
  }

  if (/\b(fix|bug|crash|regression|broken)\b/.test(sample)) return "fix";
  if (/\b(refactor|rename|cleanup)\b/.test(sample)) return "refactor";
  if (test >= 3 && test >= chore && test >= docs) return "test";
  if (docs >= 3 && docs >= chore) return "docs";
  if (chore >= 4) return "chore";
  if (feat >= Math.ceil(entries.length / 3)) return "feat";
  return "chore";
}

/**
 * @param {NameStatusEntry[]} entries
 */
function describeTouches(entries, maxBasenames = 3) {
  const baseNames = [];
  const seen = new Set();
  for (const e of entries) {
    const leaf = e.path.split("/").pop() || e.path;
    if (/lock\.json$/i.test(leaf) || /^yarn\.lock$/i.test(leaf)) continue;
    if (!seen.has(leaf)) {
      seen.add(leaf);
      baseNames.push(leaf);
    }
    if (baseNames.length >= maxBasenames) break;
  }
  const n = entries.length;
  const tail = baseNames.length ? baseNames.join(", ") : `${n} paths`;
  return n === 1 ? tail : `${tail} (${n} files)`;
}

/**
 * @param {string} line
 * @param {number} maxLen
 */
function clampSubject(line, maxLen = 72) {
  let s = String(line || "")
    .replace(/\s+/g, " ")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
  if (s.length > maxLen) s = `${s.slice(0, maxLen - 1)}…`;
  return s;
}

/**
 * @param {NameStatusEntry[]} entries
 * @param {string} shortstat
 * @param {string} [diffSample]
 */
function buildSubject(entries, shortstat, diffSample = "") {
  if (!entries.length) return FALLBACK_SUBJECT;
  const type = inferType(entries, diffSample);
  const scope = dominantScope(entries);
  const touches = describeTouches(entries);
  const raw = `${type}(${scope}): vmax push - ${touches}`;
  return clampSubject(raw);
}

/**
 * @param {NameStatusEntry[]} entries
 * @param {string} shortstat
 */
function buildInventoryBody(entries, shortstat) {
  const lines = ["Cached changes:", ...entries.map((e) => ` ${e.status}\t${e.path}`)];
  lines.push("");
  lines.push("Diffstat:");
  lines.push(shortstat.trim() ? ` ${shortstat.trim()}` : " (none)");
  lines.push("");
  lines.push("Generated-by: vmax-workspace-push (EXE-35)");
  return lines.join("\n");
}

/**
 * After `git add -A`, compose subject + body for `git commit`.
 * Optionally enriches the body via backend summarize-diff when reachable.
 *
 * @param {string} repoPath
 * @returns {Promise<{ subject: string, body: string }>}
 */
async function composeWorkspaceQuickCommit(repoPath) {
  const ns = spawnGit(repoPath, ["diff", "--cached", "--name-status"]);
  const entries = parseNameStatus(ns.stdout || "");

  const st = spawnGit(repoPath, ["diff", "--cached", "--shortstat"]);
  const shortstat = String(st.stdout || "").trim();

  const diffProc = spawnGit(repoPath, ["diff", "--cached", "--no-color"]);
  const diffText = String(diffProc.stdout || "");

  const subject = buildSubject(entries, shortstat, diffText);

  let body = buildInventoryBody(entries, shortstat);

  const capped = diffText.length > 120_000 ? `${diffText.slice(0, 120_000)}\n… (truncated for summary)` : diffText;

  if (capped.trim()) {
    try {
      const { summarizeDiff } = require("./aiClient.js");
      const { summarizeDiffText } = require("./repoContext.js");
      const out = await summarizeDiff({ diff: capped, fallback: summarizeDiffText });
      const summary = String(out.summary || "").trim();
      if (summary && summary !== "(no diff)") {
        const clipped = summary.length > 2800 ? `${summary.slice(0, 2800)}…` : summary;
        body = `Agent-readable summary:\n${clipped}\n\n---\n${body}`;
      }
    } catch {
      /* heuristic-only body */
    }
  }

  return { subject: subject || FALLBACK_SUBJECT, body };
}

module.exports = {
  FALLBACK_SUBJECT,
  parseNameStatus,
  inferType,
  dominantScope,
  buildSubject,
  buildInventoryBody,
  composeWorkspaceQuickCommit,
};
