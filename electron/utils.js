// Tiny shared helpers used across electron/ modules.

const path = require("path");
const os = require("os");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Electron started from Finder/Dock often inherits PATH=/usr/bin:/bin — CLIs installed
 * via Homebrew, npm -g, or Volta disappear. Prepends usual locations for agent bridges.
 *
 * @param {NodeJS.ProcessEnv} [baseEnv]
 * @returns {NodeJS.ProcessEnv}
 */
function augmentCliPathEnv(baseEnv = process.env) {
  const home = os.homedir();
  const prepend = [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    path.join(home, ".volta", "bin"),
    path.join(home, ".npm-global", "bin"),
    path.join(home, ".local", "bin"),
    path.join(home, "bin"),
  ].join(":");
  const tail = baseEnv.PATH || "/usr/bin:/bin:/usr/sbin:/sbin";
  return { ...baseEnv, PATH: `${prepend}:${tail}` };
}

module.exports = { sleep, augmentCliPathEnv };
