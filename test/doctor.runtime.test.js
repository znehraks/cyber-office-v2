import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { bootstrapRuntimeWorkers } from "../src/lib/bootstrap.js";
import { runDoctor } from "../src/lib/doctor.js";
import { ensureRuntimeLayout, readJson, writeJson } from "../src/lib/runtime.js";

async function makeRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "co-v2-doctor-"));
  await ensureRuntimeLayout(root);
  await bootstrapRuntimeWorkers(root);
  return root;
}

test("doctor fails when a legacy role is missing from the registry", async () => {
  const root = await makeRoot();
  const registryPath = path.join(root, "role-registry.json");
  const registry = await readJson(registryPath);
  registry.roles = registry.roles.filter((role) => role.name !== "researcher");
  await writeJson(registryPath, registry);

  await assert.rejects(runDoctor(root), /Missing legacy role: researcher/);
});

test("doctor fails when an unsupported high role is present", async () => {
  const root = await makeRoot();
  const registryPath = path.join(root, "role-registry.json");
  const registry = await readJson(registryPath);
  registry.roles.push({
    name: "fullstack-dev-high",
    kind: "high",
    model: "opus",
    tier: "high",
    effort: "high",
    sourceRole: "fullstack-dev",
    description: "unsupported test role",
  });
  await writeJson(registryPath, registry);

  await assert.rejects(runDoctor(root), /Unsupported high role present: fullstack-dev-high/);
});

test("doctor fails when a worker asset is missing", async () => {
  const root = await makeRoot();
  await fs.unlink(path.join(root, "runtime", "workers", "researcher", "prompt.txt"));
  await assert.rejects(runDoctor(root), /Worker asset missing: researcher\/prompt.txt/);
});
