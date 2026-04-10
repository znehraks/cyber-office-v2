import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export function resolveRepoRoot(importMetaUrl) {
  if (process.env.CO_ROOT_DIR) {
    return process.env.CO_ROOT_DIR;
  }

  const modulePath = fileURLToPath(importMetaUrl);
  let current = path.dirname(modulePath);

  while (true) {
    if (fs.existsSync(path.join(current, "package.json"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Unable to resolve repo root from ${modulePath}`);
    }

    current = parent;
  }
}
