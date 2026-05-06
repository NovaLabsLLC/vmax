// Create a new local project folder and (optionally) initialize git.
// Used by the auto-execute "create-project" action triggered from the chat.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "new-project";
}

function uniqueDir(parent, name) {
  let dir = path.join(parent, name);
  if (!fs.existsSync(dir)) return dir;
  for (let i = 2; i < 1000; i++) {
    const candidate = path.join(parent, `${name}-${i}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(parent, `${name}-${Date.now()}`);
}

function gitInit(cwd) {
  return new Promise((resolve) => {
    execFile("git", ["init"], { cwd, timeout: 8000 }, () => resolve());
  });
}

async function createProject({ name, parentDir }) {
  const parent = parentDir || path.join(os.homedir(), "Desktop");
  if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
  const slug = slugify(name);
  const dir = uniqueDir(parent, slug);
  fs.mkdirSync(dir, { recursive: true });
  // Drop a tiny marker so Cursor opens the folder cleanly.
  fs.writeFileSync(path.join(dir, "README.md"), `# ${slug}\n\n(Created by Vmax.)\n`);
  await gitInit(dir);
  return { ok: true, path: dir, name: slug };
}

module.exports = { createProject, slugify };
