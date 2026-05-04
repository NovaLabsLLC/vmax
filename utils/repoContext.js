// Shells out to git to build a snapshot of the repo's current state.

const { execFile } = require("child_process");
const path = require("path");

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, stdout: stdout || "", stderr: stderr || String(err.message) });
      else resolve({ ok: true, stdout: stdout.toString(), stderr: stderr.toString() });
    });
  });
}

async function scanRepo(repoPath) {
  if (!repoPath) throw new Error("repoPath required");

  const [top, branch, changed, status, diffShort] = await Promise.all([
    run("git", ["rev-parse", "--show-toplevel"], repoPath),
    run("git", ["branch", "--show-current"], repoPath),
    run("git", ["diff", "--name-only"], repoPath),
    run("git", ["status", "--short"], repoPath),
    run("git", ["diff", "--stat"], repoPath),
  ]);

  if (!top.ok) {
    return { ok: false, error: "Not a git repository (or git not on PATH)." };
  }

  const root = top.stdout.trim();
  return {
    ok: true,
    root,
    name: path.basename(root),
    branch: branch.stdout.trim() || "(detached)",
    changedFiles: changed.stdout.split("\n").map((l) => l.trim()).filter(Boolean),
    status: status.stdout.split("\n").map((l) => l.trim()).filter(Boolean),
    diffStat: diffShort.stdout.trim(),
  };
}

// Used as a deterministic fallback if AI summarization fails.
function summarizeDiffText(diff) {
  const files = new Set();
  for (const line of (diff || "").split("\n")) {
    const m = line.match(/^\+\+\+\s+b\/(.+)$/);
    if (m) files.add(m[1]);
  }
  return [...files].slice(0, 20).map((f) => `• ${f}`).join("\n") || "(no changes detected)";
}

module.exports = { scanRepo, summarizeDiffText };
