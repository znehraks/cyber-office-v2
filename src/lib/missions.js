import path from "node:path";

import { appendEvent } from "./events.js";
import {
  createStampedId,
  nowIso,
  readJson,
  runtimePath,
  withResourceLock,
  writeJson,
} from "./runtime.js";

export function createMission(input) {
  const createdAt = nowIso(input.now);
  const missionId =
    input.missionId ?? createStampedId("mission", input.ingressKey ?? input.userRequest, createdAt);

  return {
    mission_id: missionId,
    source: input.source ?? "discord",
    ingress_key: input.ingressKey,
    thread_ref: input.threadRef ?? null,
    user_request: input.userRequest,
    status: input.status ?? "running",
    category: input.category,
    owner: input.owner ?? "ceo",
    priority_floor: input.priorityFloor,
    created_at: createdAt,
    updated_at: createdAt,
    active_job_ids: input.activeJobIds ?? [],
    completed_job_ids: input.completedJobIds ?? [],
    failed_job_ids: input.failedJobIds ?? [],
    backlog: input.backlog ?? [],
    final_artifacts: input.finalArtifacts ?? [],
    closeout: {
      status: input.closeout?.status ?? "pending",
      status_required: true,
      next_steps_required: true,
      obsidian_note_required: true,
      required_reports:
        input.closeout?.required_reports ??
        [
          "mission.created",
          "job.routed",
          "handoff.completed",
          "job.retried",
          "mission.completed",
        ],
    },
  };
}

function missionFile(root, missionId) {
  return runtimePath(root, "missions", `${missionId}.json`);
}

export async function readMission(root, missionId) {
  return readJson(missionFile(root, missionId));
}

export async function writeMission(root, mission) {
  mission.updated_at = nowIso(mission.updated_at);
  await writeJson(missionFile(root, mission.mission_id), mission);
  return mission;
}

export async function upsertMission(root, mission, options = {}) {
  return withResourceLock(
    root,
    `mission-${mission.mission_id}`,
    async () => {
      const existing = await readMission(root, mission.mission_id);
      if (!existing) {
        await writeMission(root, mission);
        await appendEvent(
          root,
          "mission.created",
          {
            mission_id: mission.mission_id,
            source: mission.source,
            category: mission.category,
          },
          {
            now: options.now,
            idempotencyKey: mission.ingress_key,
          },
        );
        return mission;
      }

      const merged = {
        ...existing,
        ...mission,
        closeout: { ...existing.closeout, ...mission.closeout },
        updated_at: nowIso(options.now),
      };
      await writeMission(root, merged);
      await appendEvent(root, "mission.updated", { mission_id: merged.mission_id }, { now: options.now });
      return merged;
    },
    options,
  );
}

export async function attachJobToMission(root, missionId, jobId, options = {}) {
  return withResourceLock(root, `mission-${missionId}`, async () => {
    const mission = await readMission(root, missionId);
    if (!mission) {
      throw new Error(`Mission not found: ${missionId}`);
    }

    if (!mission.active_job_ids.includes(jobId)) {
      mission.active_job_ids.push(jobId);
      mission.updated_at = nowIso(options.now);
      await writeMission(root, mission);
    }
    return mission;
  });
}

export function missionArtifactDir(root, missionId) {
  return path.join(runtimePath(root, "artifacts"), missionId);
}
