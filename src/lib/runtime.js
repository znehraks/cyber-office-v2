import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import process from "node:process";

export const RUNTIME_DIRS = [
  "runtime",
  "runtime/missions",
  "runtime/jobs",
  "runtime/events",
  "runtime/artifacts",
  "runtime/ingress",
  "runtime/packets",
  "runtime/workers",
  "runtime/locks",
  "runtime/pids",
  "runtime/state",
  "runtime/state/job-keys",
  "runtime/state/attempt-keys",
  "runtime/state/reports",
  "runtime/state/closeouts",
];

export function runtimePath(root, ...segments) {
  return path.join(root, "runtime", ...segments);
}

export function nowIso(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString();
}

export function hashValue(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function createStampedId(prefix, seed, at = nowIso()) {
  const stamp = at.replaceAll(/[-:.TZ]/g, "").slice(0, 14);
  return `${prefix}-${stamp}-${hashValue(seed).slice(0, 8)}`;
}

export async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureRuntimeLayout(root) {
  for (const dir of RUNTIME_DIRS) {
    await fs.mkdir(path.join(root, dir), { recursive: true });
  }

  const eventsFile = runtimePath(root, "events", "events.jsonl");
  if (!(await exists(eventsFile))) {
    await fs.writeFile(eventsFile, "", "utf8");
  }

  return root;
}

export async function readJson(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

export async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
  return value;
}

export async function appendJsonl(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

export async function openExclusive(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  return fs.open(filePath, "wx");
}

export async function safeUnlink(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function readLock(lockPath) {
  return readJson(lockPath, null);
}

export async function withResourceLock(
  root,
  resourceName,
  callback,
  options = {},
) {
  const staleMs = options.staleMs ?? 30_000;
  const timeoutMs = options.timeoutMs ?? 3_000;
  const ownerPid = options.ownerPid ?? String(process.pid);
  const startedAt = Date.now();
  const lockPath = runtimePath(root, "locks", `${resourceName}.lock.json`);

  while (true) {
    const now = nowIso(options.now);
    const leaseExpiresAt = new Date(Date.parse(now) + staleMs).toISOString();

    try {
      const handle = await openExclusive(lockPath);
      const lockState = {
        resource: resourceName,
        owner_pid: ownerPid,
        leased_at: now,
        lease_expires_at: leaseExpiresAt,
      };
      await handle.writeFile(`${JSON.stringify(lockState, null, 2)}\n`, "utf8");
      await handle.close();

      try {
        return await callback(lockState);
      } finally {
        await safeUnlink(lockPath);
      }
    } catch (error) {
      if (!error || error.code !== "EEXIST") {
        throw error;
      }

      const currentLock = await readLock(lockPath);
      if (currentLock) {
        const expired = Date.parse(currentLock.lease_expires_at) <= Date.now();
        if (expired) {
          await safeUnlink(lockPath);
          continue;
        }
      }

      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`Timed out waiting for lock ${resourceName}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}
