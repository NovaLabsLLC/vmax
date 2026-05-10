// Tiny shared helpers used across electron/ modules.

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { sleep };
