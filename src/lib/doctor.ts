import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { RoleRegistryFile } from "../types/domain.js";
import { parseRoleRegistryFile } from "../types/domain.js";
import { validateProjectRegistry } from "./projects.js";
import { ALLOWED_HIGH_ROLES, LEGACY_SPECIALIST_ROLES } from "./roles.js";
import { exists, readJson, runtimePath } from "./runtime.js";

export async function runDoctor(
  root: string,
): Promise<{ ok: true; roles: number; worker_dirs: number }> {
  const registryPath = path.join(root, "role-registry.json");
  const registry: RoleRegistryFile | null = await readJson(
    registryPath,
    parseRoleRegistryFile,
    null,
  );
  if (!registry) {
    throw new Error("role-registry.json missing");
  }

  const roleNames = new Set(registry.roles.map((role) => role.name));
  for (const role of LEGACY_SPECIALIST_ROLES) {
    if (!roleNames.has(role)) {
      throw new Error(`Missing legacy role: ${role}`);
    }
  }

  const highRoles = registry.roles
    .filter((role) => role.kind === "high")
    .map((role) => role.name);
  for (const role of highRoles) {
    if (!ALLOWED_HIGH_ROLES.includes(role)) {
      throw new Error(`Unsupported high role present: ${role}`);
    }
  }

  for (const role of registry.roles) {
    const dir = runtimePath(root, "workers", role.name);
    const required = ["prompt.txt", "settings.json", "mcp.json"];
    for (const file of required) {
      if (!(await exists(path.join(dir, file)))) {
        throw new Error(`Worker asset missing: ${role.name}/${file}`);
      }
    }
  }

  await validateProjectRegistry(root);

  const files = await fs.readdir(runtimePath(root, "workers"));
  return {
    ok: true,
    roles: registry.roles.length,
    worker_dirs: files.length,
  };
}
