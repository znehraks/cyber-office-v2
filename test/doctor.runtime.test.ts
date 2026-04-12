import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { bootstrapRuntimeWorkers } from "../src/lib/bootstrap.js";
import { runDoctor } from "../src/lib/doctor.js";
import { writeProjectRegistry } from "../src/lib/projects.js";
import {
  ensureRuntimeLayout,
  readJson,
  writeJson,
} from "../src/lib/runtime.js";
import { parseRoleRegistryFile } from "../src/types/domain.js";

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "co-v2-doctor-"));
  await ensureRuntimeLayout(root);
  await bootstrapRuntimeWorkers(root);
  return root;
}

test("doctor fails when a legacy role is missing from the registry", async () => {
  const root = await makeRoot();
  const registryPath = path.join(root, "role-registry.json");
  const registry = await readJson(registryPath, parseRoleRegistryFile);
  registry.roles = registry.roles.filter((role) => role.name !== "researcher");
  await writeJson(registryPath, registry);

  await assert.rejects(runDoctor(root), /Missing legacy role: researcher/);
});

test("doctor fails when an unsupported high role is present", async () => {
  const root = await makeRoot();
  const registryPath = path.join(root, "role-registry.json");
  const registry = await readJson(registryPath, parseRoleRegistryFile);
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

  await assert.rejects(
    runDoctor(root),
    /Unsupported high role present: fullstack-dev-high/,
  );
});

test("doctor fails when a worker asset is missing", async () => {
  const root = await makeRoot();
  await fs.unlink(
    path.join(root, "runtime", "workers", "researcher", "prompt.txt"),
  );
  await assert.rejects(
    runDoctor(root),
    /Worker asset missing: researcher\/prompt.txt/,
  );
});

test("doctor fails when project registry has duplicate discord channel ids", async () => {
  const root = await makeRoot();
  const obsidianRoot = await fs.mkdtemp(path.join(os.tmpdir(), "co-v2-docs-"));
  process.env["CO_OBSIDIAN_PROJECTS_ROOT"] = obsidianRoot;
  await fs.mkdir(path.join(obsidianRoot, "sns-app"), { recursive: true });
  await fs.mkdir(path.join(obsidianRoot, "tabpet"), { recursive: true });
  await writeProjectRegistry(root, {
    projects: [
      {
        project_slug: "sns-app",
        display_name: "SNS App",
        discord_channel_id: "channel-1",
        obsidian_rel_dir: "sns-app",
      },
      {
        project_slug: "tabpet",
        display_name: "Tabpet",
        discord_channel_id: "channel-1",
        obsidian_rel_dir: "tabpet",
      },
    ],
  });

  await assert.rejects(runDoctor(root), /Duplicate project discord_channel_id/);
});

test("doctor fails when a project registry path does not exist under the Obsidian root", async () => {
  const root = await makeRoot();
  const obsidianRoot = await fs.mkdtemp(path.join(os.tmpdir(), "co-v2-docs-"));
  process.env["CO_OBSIDIAN_PROJECTS_ROOT"] = obsidianRoot;
  await writeProjectRegistry(root, {
    projects: [
      {
        project_slug: "sns-app",
        display_name: "SNS App",
        discord_channel_id: "channel-1",
        obsidian_rel_dir: "sns-app",
      },
    ],
  });

  await assert.rejects(runDoctor(root), /Project Obsidian path missing/);
});
