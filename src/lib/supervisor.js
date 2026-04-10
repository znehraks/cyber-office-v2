import { appendEvent } from "./events.js";
import { ensureRetryJob, readJob, transitionJobStatus, updateJob } from "./jobs.js";
import { nowIso, readJson, runtimePath, writeJson } from "./runtime.js";
import { recoverStaleIngressClaims } from "./ingress.js";

function leaseFile(root) {
  return runtimePath(root, "state", "supervisor.json");
}

export async function acquireSupervisorLease(root, options = {}) {
  const now = nowIso(options.now);
  const leaseMs = options.leaseMs ?? 65_000;
  const existing = await readJson(leaseFile(root));

  if (existing) {
    const expired = Date.parse(existing.lease_expires_at) <= Date.parse(now);
    if (!expired && existing.owner_pid !== options.ownerPid) {
      throw new Error(`Supervisor lease held by ${existing.owner_pid}`);
    }
  }

  const next = {
    owner_pid: options.ownerPid,
    leased_at: now,
    lease_expires_at: new Date(Date.parse(now) + leaseMs).toISOString(),
    taken_over: Boolean(existing && existing.owner_pid !== options.ownerPid),
  };
  await writeJson(leaseFile(root), next);
  return next;
}

async function assertLease(root, ownerPid, now) {
  const lease = await readJson(leaseFile(root));
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

export async function supervisorTick(root, options = {}) {
  const now = nowIso(options.now);
  await acquireSupervisorLease(root, {
    ownerPid: options.ownerPid,
    now,
    leaseMs: options.leaseMs ?? 65_000,
  });

  const recoveredIngresses = await recoverStaleIngressClaims(root, {
    now,
    staleAfterMs: options.staleIngressAfterMs ?? 60_000,
  });

  const jobsDir = runtimePath(root, "jobs");
  const files = await (await import("node:fs/promises")).default.readdir(jobsDir);
  const retried = [];
  const failed = [];

  for (const file of files) {
    if (!file.endsWith(".json")) {
      continue;
    }

    const job = await readJob(root, file.replace(/\.json$/, ""));
    if (!job || job.status !== "running") {
      continue;
    }

    const lastSeen = Date.parse(job.progress_at ?? job.heartbeat_at ?? job.started_at ?? job.created_at);
    if (Date.parse(now) - lastSeen < (options.staleAfterMs ?? 90_000)) {
      continue;
    }

    const stalled = await transitionJobStatus(root, job.job_id, ["running"], "stalled", {}, { now });
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

    await transitionJobStatus(root, job.job_id, ["stalled"], "failed", {}, { now });
    failed.push(job.job_id);
    await appendEvent(root, "worker.failed", { mission_id: job.mission_id, job_id: job.job_id }, { now });
  }

  return {
    recoveredIngresses,
    retried,
    failed,
  };
}
