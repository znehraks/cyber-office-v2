#!/usr/bin/env node
import * as fs from "node:fs/promises";

import { resolveRepoRoot } from "../lib/root.js";
import { ensureRuntimeLayout, runtimePath } from "../lib/runtime.js";

async function clearDirectory(
  root: string,
  relativeSegments: string[],
): Promise<void> {
  const directory = runtimePath(root, ...relativeSegments);
  const entries = await fs.readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === ".gitkeep") {
      continue;
    }

    const entryPath = `${directory}/${entry.name}`;
    await fs.rm(entryPath, { force: true, recursive: true });
  }
}

async function main(): Promise<void> {
  const root = resolveRepoRoot(import.meta.url);
  await ensureRuntimeLayout(root);

  await clearDirectory(root, ["missions"]);
  await clearDirectory(root, ["epics"]);
  await clearDirectory(root, ["jobs"]);
  await clearDirectory(root, ["ingress"]);
  await clearDirectory(root, ["artifacts"]);
  await clearDirectory(root, ["packets"]);
  await clearDirectory(root, ["locks"]);
  await clearDirectory(root, ["pids"]);
  await clearDirectory(root, ["state", "job-keys"]);
  await clearDirectory(root, ["state", "attempt-keys"]);
  await clearDirectory(root, ["state", "reports"]);
  await clearDirectory(root, ["state", "closeouts"]);
  await clearDirectory(root, ["state", "epic-threads"]);
  await clearDirectory(root, ["state", "epic-slugs"]);
  await clearDirectory(root, ["state", "pending-epic-resolutions"]);
  await clearDirectory(root, ["state", "local-projects"]);
  await fs.rm(runtimePath(root, "state", "supervisor.json"), { force: true });
  await fs.writeFile(runtimePath(root, "events", "events.jsonl"), "", "utf8");
}

void main();
