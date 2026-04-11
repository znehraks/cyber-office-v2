import * as fs from "node:fs/promises";

import type {
  Job,
  SupervisorLease,
  SupervisorLeaseOptions,
  SupervisorTickOptions,
} from "../types/domain.js";
import { parseSupervisorLease } from "../types/domain.js";
import { appendEvent } from "./events.js";
import { recoverStaleIngressClaims } from "./ingress.js";
import {
  ensureRetryJob,
  readJob,
  transitionJobStatus,
  updateJob,
} from "./jobs.js";
import { nowIso, readJson, runtimePath, writeJson } from "./runtime.js";

function leaseFile(root: string): string {
  return runtimePath(root, "state", "supervisor.json");
}

function isPidLike(value: string): boolean {
  return /^[0-9]+$/.test(String(value));
}

function processExists(pid: string): boolean {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EPERM") {
      return true;
    }
    if (error instanceof Error && "code" in error && error.code === "ESRCH") {
      return false;
    }
    throw error;
  }
}

function isLeaseOwnerAlive(
  ownerPid: string,
  options: Pick<SupervisorLeaseOptions, "isOwnerAlive"> = {},
): boolean {
  if (options.isOwnerAlive) {
    return options.isOwnerAlive(ownerPid);
  }
  if (!isPidLike(ownerPid)) {
    return true;
  }
  return processExists(ownerPid);
}

export async function acquireSupervisorLease(
  root: string,
  options: SupervisorLeaseOptions,
): Promise<SupervisorLease> {
  const now = nowIso(options.now);
  const leaseMs = options.leaseMs ?? 65_000;
  const existing = await readJson(leaseFile(root), parseSupervisorLease, null);

  if (existing) {
    const expired = Date.parse(existing.lease_expires_at) <= Date.parse(now);
    const ownerAlive = isLeaseOwnerAlive(existing.owner_pid, options);
    if (!expired && ownerAlive && existing.owner_pid !== options.ownerPid) {
      throw new Error(`Supervisor lease held by ${existing.owner_pid}`);
    }
  }

  const next: SupervisorLease = {
    owner_pid: options.ownerPid,
    leased_at: now,
    lease_expires_at: new Date(Date.parse(now) + leaseMs).toISOString(),
    taken_over: Boolean(existing && existing.owner_pid !== options.ownerPid),
  };
  await writeJson(leaseFile(root), next);
  return next;
}

async function assertLease(
  root: string,
  ownerPid: string,
  now: string,
): Promise<SupervisorLease> {
  const lease = await readJson(leaseFile(root), parseSupervisorLease, null);
  if (!lease) {
    throw new Error("Supervisor lease missing");
  }
  if (lease.owner_pid !== ownerPid) {
    throw new Error(`Supervisor lease owned by ${lease.owner_pid}`);
  }
  if (Date.parse(lease.lease_expires_at) <= Date.parse(now)) {
    throw new Error("Supervisor lease expired");
  }
  return lease;
}

export async function supervisorTick(
  root: string,
  options: SupervisorTickOptions,
): Promise<{
  recoveredIngresses: ReturnType<
    typeof recoverStaleIngressClaims
  > extends Promise<infer T>
    ? T
    : never;
  retried: Job[];
  failed: string[];
}> {
  const now = nowIso(options.now);
  await acquireSupervisorLease(root, {
    ownerPid: options.ownerPid,
    now,
    leaseMs: options.leaseMs ?? 65_000,
  });
  await assertLease(root, options.ownerPid, now);

  const recoveredIngresses = await recoverStaleIngressClaims(root, {
    now,
    staleAfterMs: options.staleIngressAfterMs ?? 60_000,
  });

  const jobsDir = runtimePath(root, "jobs");
  const files = await fs.readdir(jobsDir);
  const retried: Job[] = [];
  const failed: string[] = [];

  for (const file of files) {
    if (!file.endsWith(".json")) {
      continue;
    }

    const job = await readJob(root, file.replace(/\.json$/, ""));
    if (!job || job.status !== "running") {
      continue;
    }

    const lastSeen = Date.parse(
      job.progress_at ?? job.heartbeat_at ?? job.started_at ?? job.created_at,
    );
    if (Date.parse(now) - lastSeen < (options.staleAfterMs ?? 90_000)) {
      continue;
    }

    const stalled = await transitionJobStatus(
      root,
      job.job_id,
      ["running"],
      "stalled",
      {},
      { now },
    );
    if (!stalled.changed) {
      continue;
    }

    if ((job.retry_count ?? 0) < (job.max_retries ?? 2)) {
      const updated = await updateJob(
        root,
        job.job_id,
        async (current) => ({
          ...current,
          retry_count: (current.retry_count ?? 0) + 1,
          report_status: { ...current.report_status, last_retry_at: now },
        }),
        { now },
      );
      const retry = await ensureRetryJob(root, updated, { now });
      retried.push(retry);
      continue;
    }

    await transitionJobStatus(
      root,
      job.job_id,
      ["stalled"],
      "failed",
      {},
      { now },
    );
    failed.push(job.job_id);
    await appendEvent(
      root,
      "worker.failed",
      { mission_id: job.mission_id, job_id: job.job_id },
      { now },
    );
  }

  return {
    recoveredIngresses,
    retried,
    failed,
  };
}
