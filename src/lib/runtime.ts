import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import * as path from "node:path";
import * as process from "node:process";

import { expectRecord, readString } from "./validation.js";

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

export interface ResourceLockState {
  resource: string;
  owner_pid: string;
  leased_at: string;
  lease_expires_at: string;
}

export interface ResourceLockOptions {
  staleMs?: number | undefined;
  timeoutMs?: number | undefined;
  ownerPid?: string | undefined;
  now?: string | number | Date | undefined;
}

interface NodeErrorLike extends Error {
  code?: string;
}

function hasNodeErrorCode(
  error: unknown,
  code: string,
): error is NodeErrorLike {
  return error instanceof Error && "code" in error && error.code === code;
}

function parseResourceLockState(value: unknown): ResourceLockState {
  const record = expectRecord(value, "resource_lock");
  return {
    resource: readString(record, "resource", "resource_lock"),
    owner_pid: readString(record, "owner_pid", "resource_lock"),
    leased_at: readString(record, "leased_at", "resource_lock"),
    lease_expires_at: readString(record, "lease_expires_at", "resource_lock"),
  };
}

export function runtimePath(root: string, ...segments: string[]): string {
  return path.join(root, "runtime", ...segments);
}

export function nowIso(value?: string | number | Date): string {
  return value ? new Date(value).toISOString() : new Date().toISOString();
}

export function hashValue(value: string): string {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function createStampedId(
  prefix: string,
  seed: string,
  at?: string,
): string {
  const stampSource = at ?? nowIso();
  const stamp = stampSource.replaceAll(/[-:.TZ]/g, "").slice(0, 14);
  return `${prefix}-${stamp}-${hashValue(seed).slice(0, 8)}`;
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureRuntimeLayout(root: string): Promise<string> {
  for (const dir of RUNTIME_DIRS) {
    await fs.mkdir(path.join(root, dir), { recursive: true });
  }

  const eventsFile = runtimePath(root, "events", "events.jsonl");
  if (!(await exists(eventsFile))) {
    await fs.writeFile(eventsFile, "", "utf8");
  }

  return root;
}

export async function readJson<T>(
  filePath: string,
  parse: (value: unknown) => T,
): Promise<T>;
export async function readJson<T>(
  filePath: string,
  parse: (value: unknown) => T,
  fallback: T,
): Promise<T>;
export async function readJson<T>(
  filePath: string,
  parse: (value: unknown) => T,
  fallback?: T,
): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return parse(JSON.parse(raw) as unknown);
  } catch (error) {
    if (hasNodeErrorCode(error, "ENOENT") && fallback !== undefined) {
      return fallback;
    }
    throw error;
  }
}

export async function writeJson<T>(filePath: string, value: T): Promise<T> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
  return value;
}

export async function appendJsonl<T>(
  filePath: string,
  value: T,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

export async function openExclusive(filePath: string): Promise<FileHandle> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  return fs.open(filePath, "wx");
}

export async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (!hasNodeErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
}

async function readLock(lockPath: string): Promise<ResourceLockState | null> {
  return readJson(lockPath, parseResourceLockState, null);
}

export async function withResourceLock<T>(
  root: string,
  resourceName: string,
  callback: (lock: ResourceLockState) => Promise<T>,
  options: ResourceLockOptions = {},
): Promise<T> {
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
      if (!hasNodeErrorCode(error, "EEXIST")) {
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

      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
  }
}
