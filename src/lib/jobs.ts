import * as fs from "node:fs/promises";
import * as path from "node:path";

import type {
  CreateJobSpec,
  Job,
  JobKeyIndex,
  JobStatus,
  PacketManifest,
} from "../types/domain.js";
import {
  parseJob,
  parseJobKeyIndex,
  parsePacketManifest,
} from "../types/domain.js";
import { appendEvent } from "./events.js";
import { attachJobToMission } from "./missions.js";
import { findRole } from "./roles.js";
import {
  createStampedId,
  exists,
  hashValue,
  nowIso,
  openExclusive,
  readJson,
  runtimePath,
  withResourceLock,
  writeJson,
} from "./runtime.js";

function parseJobIndexOrNull(value: unknown): JobKeyIndex {
  return parseJobKeyIndex(value);
}

export function jobFile(root: string, jobId: string): string {
  return runtimePath(root, "jobs", `${jobId}.json`);
}

export async function readJob(
  root: string,
  jobId: string,
): Promise<Job | null> {
  return readJson(jobFile(root, jobId), parseJob, null);
}

export async function writeJob(root: string, job: Job): Promise<Job> {
  await writeJson(jobFile(root, job.job_id), job);
  return job;
}

function computeJobKey(spec: CreateJobSpec): string {
  return (
    spec.jobKey ??
    `${spec.missionId}:${spec.worker}:${spec.category}:${spec.task}:${spec.attemptNo ?? 0}`
  );
}

async function createUniqueIndex(
  indexPath: string,
  value: JobKeyIndex,
): Promise<{ created: boolean; value: JobKeyIndex }> {
  try {
    const handle = await openExclusive(indexPath);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.close();
    return { created: true, value };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      return {
        created: false,
        value: await readJson(indexPath, parseJobIndexOrNull),
      };
    }
    throw error;
  }
}

export async function createJob(
  root: string,
  spec: CreateJobSpec,
): Promise<Job> {
  const role = findRole(spec.worker);
  const createdAt = nowIso(spec.now);
  const jobKey = computeJobKey(spec);
  const jobHash = hashValue(jobKey);
  const indexPath = runtimePath(root, "state", "job-keys", `${jobHash}.json`);
  const attemptNo = spec.attemptNo ?? 0;
  const baseJobId = spec.baseJobId ?? createStampedId("job", jobKey, createdAt);
  const jobId =
    attemptNo === 0 ? baseJobId : `${baseJobId}--attempt-${attemptNo}`;

  const indexed = await createUniqueIndex(indexPath, {
    job_id: jobId,
    job_key: jobKey,
  });
  if (!indexed.created) {
    const existingJob = await readJob(root, indexed.value.job_id);
    if (!existingJob) {
      throw new Error(`Indexed job missing: ${indexed.value.job_id}`);
    }
    return existingJob;
  }

  const job: Job = {
    job_id: jobId,
    base_job_id: spec.baseJobId ?? jobId,
    mission_id: spec.missionId,
    worker: spec.worker,
    model: role.model,
    tier: role.tier,
    job_key: jobKey,
    status: "queued",
    category: spec.category,
    priority: spec.priority,
    attempt_no: attemptNo,
    input: {
      task: spec.task,
      deliverable: spec.deliverable,
      constraints: spec.constraints ?? [],
      input_refs: spec.inputRefs ?? [],
    },
    artifacts: [],
    handoff_requests: [],
    created_at: createdAt,
    started_at: null,
    heartbeat_at: null,
    progress_at: null,
    finished_at: null,
    retry_count: spec.retryCount ?? 0,
    max_retries: spec.maxRetries ?? 2,
    worker_pid_ref: runtimePath(root, "pids", `${jobId}.pid`),
    packet_ref: runtimePath(root, "packets", jobId, "manifest.json"),
    report_status: {},
    retry_of: spec.retryOf ?? null,
  };

  await writeJob(root, job);
  await attachJobToMission(root, spec.missionId, job.job_id, { now: spec.now });
  await appendEvent(
    root,
    "job.created",
    {
      mission_id: spec.missionId,
      job_id: job.job_id,
      worker: job.worker,
      model: job.model,
      attempt_no: attemptNo,
    },
    {
      now: spec.now,
      idempotencyKey: job.job_key,
    },
  );
  return job;
}

export async function transitionJobStatus(
  root: string,
  jobId: string,
  fromStatuses: JobStatus[],
  toStatus: JobStatus,
  patch: Partial<Job> = {},
  options: { now?: string | undefined } = {},
): Promise<{ changed: boolean; job: Job }> {
  return withResourceLock(root, `job-${jobId}`, async () => {
    const job = await readJob(root, jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    if (!fromStatuses.includes(job.status)) {
      return { changed: false, job };
    }

    const now = nowIso(options.now);
    const next: Job = {
      ...job,
      ...patch,
      status: toStatus,
    };

    if (toStatus === "running") {
      next.started_at = job.started_at ?? now;
      next.heartbeat_at = now;
      next.progress_at = now;
    }

    if (["completed", "failed", "stalled"].includes(toStatus)) {
      next.finished_at = patch.finished_at ?? now;
    }

    await writeJob(root, next);
    return { changed: true, job: next };
  });
}

export async function updateJob(
  root: string,
  jobId: string,
  updater: (job: Job) => Promise<Job> | Job,
  options: { now?: string | undefined } = {},
): Promise<Job> {
  return withResourceLock(
    root,
    `job-${jobId}`,
    async () => {
      const job = await readJob(root, jobId);
      if (!job) {
        throw new Error(`Job not found: ${jobId}`);
      }
      const next = await updater(job);
      await writeJob(root, next);
      return next;
    },
    options,
  );
}

export async function touchJobActivity(
  root: string,
  jobId: string,
  options: { now?: string | undefined } = {},
): Promise<Job> {
  return updateJob(
    root,
    jobId,
    async (job) => {
      const now = nowIso(options.now);
      return {
        ...job,
        heartbeat_at: now,
        progress_at: now,
      };
    },
    options,
  );
}

export async function writePacket(
  root: string,
  jobId: string,
  manifest: PacketManifest,
): Promise<PacketManifest> {
  const packetDir = runtimePath(root, "packets", jobId);
  await fs.mkdir(packetDir, { recursive: true });
  const packetPath = path.join(packetDir, "manifest.json");
  const existing = await readJson(packetPath, parsePacketManifest, null);
  if (existing) {
    const previous = JSON.stringify(existing);
    const next = JSON.stringify(manifest);
    if (previous !== next) {
      throw new Error(`Packet for ${jobId} is immutable and already exists`);
    }
    return existing;
  }

  await writeJson(packetPath, manifest);
  return manifest;
}

export async function readPacket(
  root: string,
  jobId: string,
): Promise<PacketManifest | null> {
  return readJson(
    runtimePath(root, "packets", jobId, "manifest.json"),
    parsePacketManifest,
    null,
  );
}

export async function ensureRetryJob(
  root: string,
  originalJob: Job,
  options: { now?: string | undefined } = {},
): Promise<Job> {
  const nextAttempt = (originalJob.attempt_no ?? 0) + 1;
  const retryKey = `${originalJob.base_job_id}:retry:${nextAttempt}`;
  const retry = await createJob(root, {
    missionId: originalJob.mission_id,
    worker: originalJob.worker,
    category: originalJob.category,
    priority: originalJob.priority,
    task: originalJob.input.task,
    deliverable: originalJob.input.deliverable,
    constraints: originalJob.input.constraints,
    inputRefs: originalJob.input.input_refs,
    jobKey: retryKey,
    baseJobId: originalJob.base_job_id,
    attemptNo: nextAttempt,
    retryCount: originalJob.retry_count,
    maxRetries: originalJob.max_retries,
    retryOf: originalJob.job_id,
    now: options.now,
  });

  const packet = await readPacket(root, originalJob.job_id);
  if (packet) {
    await writePacket(root, retry.job_id, packet);
  }

  await appendEvent(
    root,
    "job.retried",
    {
      mission_id: originalJob.mission_id,
      job_id: originalJob.job_id,
      retry_job_id: retry.job_id,
      attempt_no: nextAttempt,
      worker: retry.worker,
    },
    { now: options.now, idempotencyKey: retryKey },
  );

  return retry;
}

export async function assertPacketRefs(
  root: string,
  jobId: string,
): Promise<PacketManifest> {
  const packet = await readPacket(root, jobId);
  if (!packet) {
    throw new Error(`Packet missing for ${jobId}`);
  }

  for (const requiredRef of packet.required_refs ?? []) {
    if (!(await exists(requiredRef))) {
      throw new Error(`Missing required ref: ${requiredRef}`);
    }
  }

  return packet;
}
