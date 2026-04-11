import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export function resolveRepoRoot(importMetaUrl: string): string {
  const rootOverride = process.env["CO_ROOT_DIR"];
  if (rootOverride) {
    return rootOverride;
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
