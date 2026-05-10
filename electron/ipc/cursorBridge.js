// IPC: paste a prompt directly into Cursor's Agent / Chat pane.
//
// Best-effort, macOS-only. Requires Accessibility permission on Electron.
// Strategy:
//   1. Put prompt (+ safety footer) on the clipboard.
//   2. Open the repo in Cursor (CLI first, falls back to `open -a Cursor`).
//   3. AppleScript: activate Cursor → ⌘I (Composer/Agent) → ⌘V → return.
//   4. If ⌘I fails, try ⌘L (Chat).
//   5. On total failure, the clipboard still has the prompt — surface a
//      message telling the user to paste manually.

const { spawn } = require("child_process");
const { ipcMain, clipboard, systemPreferences, shell } = require("electron");
const { sleep } = require("../utils.js");
const { runApplescriptFile, cursorPasteApplescript } = require("../applescript.js");
const { CURSOR_CLIPBOARD_SAFETY_FOOTER } = require("../../utils/commandSafety.js");

function register() {
  ipcMain.handle("exec:send-to-cursor-chat", async (_evt, { repoPath, prompt }) => {
    if (process.platform !== "darwin")
      return { ok: false, reason: "platform", message: "Auto-send is only wired up on macOS." };

    if (!systemPreferences.isTrustedAccessibilityClient(false)) {
      systemPreferences.isTrustedAccessibilityClient(true);
      return {
        ok: false, reason: "accessibility",
        message: "Grant Accessibility permission to Electron, then quit and run again.",
      };
    }

    clipboard.writeText(String(prompt ?? "") + CURSOR_CLIPBOARD_SAFETY_FOOTER);
    await sleep(280);

    let openedRepoVia = "none";
    await new Promise((resolve) => {
      const tryRun = (cmd, args) => new Promise((res) => {
        const c = spawn(cmd, args, { detached: true, stdio: "ignore" });
        c.on("error", () => res(false));
        c.on("spawn", () => { c.unref(); res(true); });
      });
      (async () => {
        if (await tryRun("cursor", [repoPath])) {
          openedRepoVia = "cursor-cli";
          return resolve();
        }
        if (await tryRun("open", ["-a", "Cursor", repoPath])) {
          openedRepoVia = "open-app";
          return resolve();
        }
        resolve();
      })();
    });

    await sleep(openedRepoVia === "none" ? 400 : 750);

    const base = { openedRepoVia };
    let first = await runApplescriptFile(cursorPasteApplescript("i"));
    if (first.code !== 0) {
      const second = await runApplescriptFile(cursorPasteApplescript("l"));
      if (second.code === 0) {
        return { ok: true, pastedVia: "applescript", pasteShortcut: "⌘L", ...base };
      }
      first = second;
    } else {
      return { ok: true, pastedVia: "applescript", pasteShortcut: "⌘I", ...base };
    }

    let urlOk = false;
    try {
      const pathPart = repoPath.startsWith("/") ? repoPath : `/${repoPath}`;
      await shell.openExternal("cursor://file" + pathPart);
      urlOk = true;
    } catch {
      /* ignore */
    }
    return {
      ok: true,
      pastedVia: "clipboard-only",
      automationFailed: true,
      pasteShortcut: "⌘I+⌘L",
      ...base,
      message: urlOk
        ? "Tried ⌘I and ⌘L automation; clipboard is ready — focus Cursor and press ⌘V in Agent or Chat."
        : first.stderr || "AppleScript failed for ⌘I and ⌘L — prompt is on the clipboard.",
    };
  });
}

module.exports = { register };
