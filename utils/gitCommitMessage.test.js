const assert = require("assert");
const {
  parseNameStatus,
  inferType,
  dominantScope,
  buildSubject,
  FALLBACK_SUBJECT,
} = require("./gitCommitMessage.js");

{
  const rows = parseNameStatus(`M\telectron/ipc/gitWorkflow.js\nA\tutils/foo.ts`);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].status, "M");
  assert.strictEqual(rows[0].path, "electron/ipc/gitWorkflow.js");
}

{
  const rows = [{ status: "M", path: "electron/ipc/x.js" }];
  assert.strictEqual(dominantScope(rows), "ipc");
}

{
  const rows = [{ status: "M", path: "README.md" }];
  assert.strictEqual(inferType(rows, ""), "docs");
}

{
  const rows = [
    { status: "M", path: "src/renderer/App.tsx" },
    { status: "M", path: "electron/main.js" },
  ];
  const diff = "fix crash when overlay mounts";
  assert.strictEqual(inferType(rows, diff), "fix");
}

{
  const rows = [{ status: "M", path: "utils/helpers.ts" }];
  const subject = buildSubject(rows, " 1 file changed, 2 insertions(+)", "");
  assert.ok(subject.includes("(utils):"));
}

assert.strictEqual(buildSubject([], "", ""), FALLBACK_SUBJECT);

console.log("gitCommitMessage.test.js OK");
