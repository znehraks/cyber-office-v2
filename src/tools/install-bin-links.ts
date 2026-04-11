#!/usr/bin/env node
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { resolveRepoRoot } from "../lib/root.js";

async function ensureLink(targetPath: string, linkPath: string): Promise<void> {
  await fs.rm(linkPath, { force: true });
  await fs.symlink(targetPath, linkPath);
}

async function main(): Promise<void> {
  const root = resolveRepoRoot(import.meta.url);
  const binDir = path.join(os.homedir(), "bin");
  await fs.mkdir(binDir, { recursive: true });

  const currentCo = path.join(root, "bin", "co");
  const legacyCo = "/Users/designc/Documents/cyber-office/bin/co";

  await ensureLink(currentCo, path.join(binDir, "co"));
  await ensureLink(legacyCo, path.join(binDir, "co-legacy"));

  process.stdout.write(
    `Installed:\n  co -> ${currentCo}\n  co-legacy -> ${legacyCo}\n`,
  );
}

void main();
