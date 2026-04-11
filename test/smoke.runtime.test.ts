import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { bootstrapRuntimeWorkers } from "../src/lib/bootstrap.js";
import { ensureRuntimeLayout } from "../src/lib/runtime.js";
import { runSmokeScenario } from "../src/lib/smoke.js";

async function makeRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "co-v2-smoke-"));
  await ensureRuntimeLayout(root);
  await bootstrapRuntimeWorkers(root);
  return root;
}

test("smoke scenario completes mission and verifies closeout", async () => {
  const root = await makeRoot();
  const result = await runSmokeScenario(root, {
    claudeBin: process.execPath,
    extraArgs: [path.resolve("dist/test/fixtures/fake-claude-success.js")],
    now: "2026-04-10T12:00:00.000Z",
    messageId: "smoke-001",
    request: "로그인 이슈 조사",
  });

  assert.equal(result.worker.status, "completed");
  assert.equal(result.closeout.status, "passed");
  assert.equal(result.report.role, "ceo");
  assert.equal(result.report.tier, "standard");
});
