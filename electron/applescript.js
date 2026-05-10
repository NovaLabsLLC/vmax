// AppleScript helpers for driving the Cursor desktop app.
//
// Shared by ipc/cursorBridge.js (the Send-to-Cursor button) and
// ipc/dispatch.js (the agent router's `cursor` branch).

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

// Run AppleScript from a temp file. More reliable than chaining `-e` flags:
// each `-e` is its own paragraph, which breaks multi-line `tell` blocks.
function runApplescriptFile(source) {
  const tmp = path.join(os.tmpdir(), `exec-cursor-${process.pid}-${Date.now()}.scpt`);
  fs.writeFileSync(tmp, source.trim() + "\n", "utf8");
  return new Promise((resolve) => {
    const child = spawn("osascript", [tmp]);
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      resolve({ code, stderr });
    });
  });
}

// openKey after ⌘: "i" = Composer/Agent pane, "l" = Chat pane (fallback).
// Sequence: activate → escape → ⌘<openKey> → ⌘V → return.
function cursorPasteApplescript(openKey) {
  return `
tell application "Cursor" to activate
delay 2.0
tell application "System Events"
  tell process "Cursor"
    set frontmost to true
  end tell
  delay 0.35
  key code 53
  delay 0.25
  keystroke "${openKey}" using {command down}
  delay 1.05
  keystroke "v" using {command down}
  delay 0.45
  key code 36
end tell
`;
}

module.exports = { runApplescriptFile, cursorPasteApplescript };
