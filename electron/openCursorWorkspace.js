// Open Cursor on a repo path: prefer `cursor` CLI, then Cursor.app‑bundled binary, then `/usr/bin/open`.
// GUI‑launched Electron often lacks PATH entries for CLI installs — callers pass augmentCliPathEnv.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const { augmentCliPathEnv } = require("./utils.js");

/**
 * Resolved path to Cursor shell helper, or the string `"cursor"` to probe PATH only.
 *
 * Override with FULL path via `CURSOR_CLI_BIN`.
 */
function resolveCursorExecutable() {
  const envPick = `${process.env.CURSOR_CLI_BIN || ""}`.trim();
  if (envPick) {
    try {
      if (fs.existsSync(envPick)) return envPick;
    } catch {
      /* ignore */
    }
  }

  const home = os.homedir();
  const candidates = [
    "/usr/local/bin/cursor",
    "/opt/homebrew/bin/cursor",
    path.join(home, ".local", "bin", "cursor"),
    "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
    path.join(home, "Applications", "Cursor.app", "Contents", "Resources", "app", "bin", "cursor"),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return "cursor";
}

/**
 * @returns {Promise<{ openedVia: string }>}
 */
async function openRepoInCursor(repoPath) {
  const env = augmentCliPathEnv(process.env);

  /** @returns {Promise<boolean>} */
  const tryDetached = (cmd, args, withAugmentedEnv = true) =>
    new Promise((res) => {
      /** @type {import('child_process').SpawnOptions} */
      const opts = { detached: true, stdio: "ignore" };
      if (withAugmentedEnv) opts.env = env;
      const c = spawn(cmd, args, opts);
      c.on("error", () => res(false));
      c.on("spawn", () => {
        c.unref();
        res(true);
      });
    });

  const resolved = resolveCursorExecutable();
  if (await tryDetached(resolved, [repoPath])) {
    return { openedVia: resolved === "cursor" ? "cursor-cli" : "cursor-path" };
  }

  /* Bundled launcher is common when user never ran “Install Shell Command…” */
  const bundled = "/Applications/Cursor.app/Contents/Resources/app/bin/cursor";
  try {
    if (fs.existsSync(bundled) && (await tryDetached(bundled, [repoPath]))) {
      return { openedVia: "cursor-bundled" };
    }
  } catch {
    /* ignore */
  }

  if (await tryDetached("/usr/bin/open", ["-a", "Cursor", repoPath], false)) {
    return { openedVia: "open-app" };
  }

  return { openedVia: "none" };
}

module.exports = { openRepoInCursor, resolveCursorExecutable };
