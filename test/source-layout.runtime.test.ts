import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";

async function listFiles(rootDir: string, current = "."): Promise<string[]> {
  const absolute = path.join(rootDir, current);
  const entries = await fs.readdir(absolute, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relative = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(rootDir, relative)));
      continue;
    }
    files.push(relative);
  }

  return files;
}

test("src, test, and scripts contain no repo-tracked js or sh sources", async () => {
  const root = process.cwd();
  const sourceFiles = [
    ...(await listFiles(root, "src")),
    ...(await listFiles(root, "test")),
    ...(await listFiles(root, "scripts")),
  ];
  const disallowed = sourceFiles.filter((file) => /\.(js|sh)$/.test(file));

  assert.deepEqual(disallowed, []);
});

test("smoke script uses built dist fixture paths", async () => {
  const raw = await fs.readFile(
    path.join(process.cwd(), "package.json"),
    "utf8",
  );
  const pkg = JSON.parse(raw);

  assert.match(
    pkg.scripts.smoke,
    /dist\/test\/fixtures\/fake-claude-success\.js/,
  );
});
