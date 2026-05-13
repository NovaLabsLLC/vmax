// IPC: repo selection / scanning + small "open this somewhere" helpers
// (Cursor, browser, clipboard) and the last/recent-repo bookkeeping.

const path = require("path");
const fs = require("fs");
const { ipcMain, BrowserWindow, dialog, clipboard, shell } = require("electron");
const { readState, writeState } = require("../state.js");
const { getCommandWindow } = require("../windows.js");
const { scanRepo } = require("../../utils/repoContext.js");
const { openRepoInCursor } = require("../openCursorWorkspace.js");

function register() {
  ipcMain.handle("exec:get-last-repo", () => {
    const s = readState();
    if (!s.lastRepo) return null;
    if (!fs.existsSync(path.join(s.lastRepo, ".git"))) return null;
    return s.lastRepo;
  });

  ipcMain.handle("exec:remember-repo", (_evt, repoPath) => {
    const s = readState();
    s.lastRepo = repoPath;
    s.recentRepos = [repoPath, ...((s.recentRepos || []).filter((p) => p !== repoPath))].slice(0, 6);
    writeState(s);
  });

  ipcMain.handle("exec:get-recent-repos", () => {
    const s = readState();
    return (s.recentRepos || []).filter((p) => fs.existsSync(path.join(p, ".git")));
  });

  ipcMain.handle("exec:pick-repo", async (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender) || getCommandWindow();
    const result = await dialog.showOpenDialog(win, {
      title: "Pick a repo",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("exec:scan-repo", (_evt, repoPath) => scanRepo(repoPath));

  // Try, in order: `cursor` CLI (common PATH + bundled) → `open -a Cursor` → cursor:// URL → Finder.
  ipcMain.handle("exec:open-in-cursor", async (_evt, repoPath) => {
    const { openedVia } = await openRepoInCursor(repoPath);
    if (openedVia === "cursor-cli" || openedVia === "cursor-path" || openedVia === "cursor-bundled") {
      return { ok: true, via: "cli" };
    }
    if (openedVia === "open-app") return { ok: true, via: "open-a" };
    try {
      await shell.openExternal(
        "cursor://file" + (String(repoPath).startsWith("/") ? repoPath : "/" + repoPath),
      );
      return { ok: true, via: "url" };
    } catch {
      /* ignore */
    }
    shell.openPath(repoPath);
    return { ok: false, via: "finder" };
  });

  ipcMain.handle("exec:copy", (_evt, text) => {
    clipboard.writeText(String(text ?? ""));
    return true;
  });

  // Open an arbitrary http(s) URL in the user's default browser. Used by the
  // step renderer to make [label](url) markdown clickable.
  ipcMain.handle("exec:open-url", async (_evt, url) => {
    const u = String(url || "").trim();
    if (!/^https?:\/\//i.test(u)) return false;
    try {
      await shell.openExternal(u);
      return true;
    } catch {
      return false;
    }
  });
}

module.exports = { register };
