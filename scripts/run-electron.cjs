/**
 * Launch Electron with ELECTRON_RUN_AS_NODE cleared. When that var is set
 * globally (e.g. in shell profile), `electron .` boots as Node and ipcMain
 * is undefined — main.js crashes on ipcMain.handle.
 */
const { spawn } = require("child_process");
const path = require("path");

const root = path.join(__dirname, "..");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const electronPath = require("electron");
const child = spawn(electronPath, ["."], {
  cwd: root,
  env,
  stdio: "inherit",
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
