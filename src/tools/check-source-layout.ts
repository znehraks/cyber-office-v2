#!/usr/bin/env node
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { resolveRepoRoot } from "../lib/root.js";

async function listFiles(
  root: string,
  relativePath: string,
): Promise<string[]> {
  const target = path.join(root, relativePath);
  const entries = await fs.readdir(target, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const nextRelative = path.join(relativePath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, nextRelative)));
      continue;
    }
    files.push(nextRelative);
  }

  return files;
}

async function main(): Promise<void> {
  const root = resolveRepoRoot(import.meta.url);
  const files = [
    ...(await listFiles(root, "src")),
    ...(await listFiles(root, "test")),
    ...(await listFiles(root, "scripts")),
  ];

  const disallowed = files.filter((file) => /\.(js|sh)$/u.test(file));
  if (disallowed.length > 0) {
    throw new Error(`Disallowed source files:\n${disallowed.join("\n")}`);
  }
}

void main();
