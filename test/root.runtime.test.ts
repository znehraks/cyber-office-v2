import * as assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";

import { resolveRepoRoot } from "../src/lib/root.js";

test("resolveRepoRoot finds the repository package boundary", () => {
  const root = resolveRepoRoot(import.meta.url);
  assert.equal(root, process.cwd());
  assert.equal(path.basename(root), "cyber-office-v2");
});
