// IPC: paste a prompt directly into Cursor's Agent / Chat pane.
//
// Best-effort, macOS-only. Requires Accessibility permission on Electron.
// Strategy:
//   1. Put prompt (+ safety footer) on the clipboard.
//   2. Open the repo in Cursor (bundled CLI, PATH `cursor`, or `open -a Cursor`).
//   3. AppleScript: activate Cursor → ⌘I → ⌘V → enter; fallback ⌘L, then ⌘K.
//   4. On total failure, the clipboard still has the prompt — surface a
//      message telling the user to paste manually.

const { ipcMain, clipboard, systemPreferences, shell, app } = require("electron");
const usageStats = require("../utils/usageStats.js");
const { sleep } = require("../utils.js");
const { tryCursorComposerPasteAttempts } = require("../applescript.js");
const { CURSOR_CLIPBOARD_SAFETY_FOOTER } = require("../../utils/commandSafety.js");
const { openRepoInCursor } = require("../openCursorWorkspace.js");

function register() {
  ipcMain.handle("exec:send-to-cursor-chat", async (_evt, { repoPath, prompt }) => {
    if (process.platform !== "darwin") {
      usageStats.record(app, "cursor_handoff", { agent: "cursor", ok: false });
      return { ok: false, reason: "platform", message: "Auto-send is only wired up on macOS." };
    }

    if (!systemPreferences.isTrustedAccessibilityClient(false)) {
      systemPreferences.isTrustedAccessibilityClient(true);
      usageStats.record(app, "cursor_handoff", { agent: "cursor", ok: false });
      return {
        ok: false,
        reason: "accessibility",
        message:
          "Grant Accessibility permission to Vmax (Electron) in System Settings → Privacy → Accessibility, quit and reopen the app.",
      };
    }

    clipboard.writeText(String(prompt ?? "") + CURSOR_CLIPBOARD_SAFETY_FOOTER);
    await sleep(280);

    const { openedVia } = await openRepoInCursor(repoPath);
    await sleep(openedVia === "none" ? 450 : 800);

    const base = { openedRepoVia: openedVia };
    const pasted = await tryCursorComposerPasteAttempts();
    if (pasted) {
      usageStats.record(app, "cursor_handoff", { agent: "cursor", ok: true });
      return {
        ok: true,
        ...base,
        pastedVia: "applescript",
        pasteShortcut: pasted.pasteShortcut,
      };
    }

    let urlOk = false;
    try {
      const pathPart =
        `${repoPath}`.startsWith("/") ? `${repoPath}` : `/${repoPath}`;
      await shell.openExternal("cursor://file" + pathPart);
      urlOk = true;
    } catch {
      /* ignore */
    }
    const stderrNote =
      "(If macOS prompted to allow Cursor control, approve System Settings → Privacy → Automation.)";
    const out = {
      ok: true,
      pastedVia: "clipboard-only",
      automationFailed: true,
      pasteShortcut: "⌘I / ⌘L / ⌘K",
      ...base,
      message: urlOk
        ? `Tried Composer/Chat shortcuts (${stderrNote}); prompt is ready — paste with ⌘V in Cursor.`
        : `Shortcuts failed; prompt copied. ${stderrNote}`,
    };
    usageStats.record(app, "cursor_handoff", { agent: "cursor", ok: out.ok === true });
    return out;
  });
}

module.exports = { register };
