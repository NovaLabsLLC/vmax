// One-click git add → commit → push for the workspace session (EXE-46).
// Uses only `readState().lastRepo` plus an optional client path check; no shell, no arbitrary cwd.

const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");
const { ipcMain } = require("electron");
const { readState } = require("../state.js");
const { composeWorkspaceQuickCommit } = require("../../utils/gitCommitMessage.js");

function runGit(repoPath, args) {
  const r = spawnSync("git", args, {
    cwd: repoPath,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    shell: false,
  });
  return {
    code: r.status,
    stdout: String(r.stdout || "").trim(),
    stderr: String(r.stderr || "").trim(),
    err: r.error || null,
  };
}

/** True if index has a diff against HEAD (work to commit). */
function hasStagedChanges(repoPath) {
  const r = spawnSync("git", ["diff", "--cached", "--quiet"], {
    cwd: repoPath,
    shell: false,
  });
  return r.status === 1;
}

function normalizeRoot(p) {
  try {
    return fs.realpathSync(path.resolve(String(p || "")));
  } catch {
    return null;
  }
}

function register() {
  ipcMain.handle("exec:workspace-git-quick-push", async (_evt, payload = {}) => {
    const expected = readState().lastRepo;
    if (!expected || !fs.existsSync(path.join(expected, ".git"))) {
      return { ok: false, error: "No active git repo selected in Command Center." };
    }

    const expRoot = normalizeRoot(expected);
    if (!expRoot) {
      return { ok: false, error: "Could not resolve selected repo path." };
    }

    const req = typeof payload.repoPath === "string" ? payload.repoPath.trim() : "";
    if (req) {
      const reqRoot = normalizeRoot(req);
      if (!reqRoot || reqRoot !== expRoot) {
        return { ok: false, error: "Workspace repo does not match the selected repo." };
      }
    }

    const repoPath = expRoot;

    const add = runGit(repoPath, ["add", "-A"]);
    if (add.err) return { ok: false, error: add.err.message || String(add.err) };
    if (add.code !== 0) {
      return { ok: false, error: add.stderr || add.stdout || `git add failed (exit ${add.code})` };
    }

    let committed = false;
    if (hasStagedChanges(repoPath)) {
      const { subject, body } = await composeWorkspaceQuickCommit(repoPath);
      const msgArgs =
        body && String(body).trim().length > 0
          ? ["commit", "-m", subject, "-m", body]
          : ["commit", "-m", subject];
      const cm = runGit(repoPath, msgArgs);
      if (cm.err) return { ok: false, error: cm.err.message || String(cm.err) };
      if (cm.code !== 0) {
        return {
          ok: false,
          error: cm.stderr || cm.stdout || `git commit failed (exit ${cm.code})`,
        };
      }
      committed = true;
    }

    const pu = runGit(repoPath, ["push"]);
    if (pu.err) return { ok: false, error: pu.err.message || String(pu.err), committed };
    if (pu.code !== 0) {
      return {
        ok: false,
        error: pu.stderr || pu.stdout || `git push failed (exit ${pu.code})`,
        committed,
      };
    }

    const br = runGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const branch = br.code === 0 && br.stdout ? br.stdout : "HEAD";

    const message = committed
      ? `Success: staged changes, committed, and pushed to ${branch}.`
      : `Success: nothing new to commit; push completed on ${branch}.`;

    return { ok: true, committed, branch, message };
  });
}

module.exports = { register };
