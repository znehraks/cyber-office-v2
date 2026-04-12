import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { Mission, MissionInput } from "../types/domain.js";
import { parseMission } from "../types/domain.js";
import { appendEvent } from "./events.js";
import {
  createStampedId,
  nowIso,
  readJson,
  runtimePath,
  withResourceLock,
  writeJson,
} from "./runtime.js";

function defaultProjectRef(): Mission["project_ref"] {
  return {
    project_slug: "cyber-office-runtime",
    display_name: "cyber-office-runtime",
    discord_channel_id: "",
    obsidian_rel_dir: "cyber-office-runtime",
    obsidian_project_dir: "",
  };
}

export function createMission(input: MissionInput): Mission {
  const createdAt = nowIso(input.now);
  const missionId =
    input.missionId ??
    createStampedId(
      "mission",
      input.ingressKey ?? input.userRequest,
      createdAt,
    );

  const projectRef = input.projectRef ?? defaultProjectRef();
  const epicRef = input.epicRef ?? {
    epic_id: createStampedId("epic", missionId, createdAt),
    project_slug: projectRef.project_slug,
    title: "runtime",
    slug: "runtime",
    discord_thread_id: input.threadRef?.chatId ?? "runtime-thread",
    status: "open" as const,
    active_mission_id: null,
    obsidian_note_ref: "",
    created_at: createdAt,
    updated_at: createdAt,
  };

  return {
    mission_id: missionId,
    source: input.source ?? "discord",
    ingress_key: input.ingressKey ?? null,
    thread_ref: input.threadRef ?? null,
    project_ref: projectRef,
    epic_ref: epicRef,
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
      required_reports: input.closeout?.required_reports ?? [
        "mission.created",
        "job.routed",
        "handoff.completed",
        "job.retried",
        "mission.completed",
      ],
    },
  };
}

function missionFile(root: string, missionId: string): string {
  return runtimePath(root, "missions", `${missionId}.json`);
}

export async function readMission(
  root: string,
  missionId: string,
): Promise<Mission | null> {
  return readJson(missionFile(root, missionId), parseMission, null);
}

export async function writeMission(
  root: string,
  mission: Mission,
): Promise<Mission> {
  const nextMission: Mission = {
    ...mission,
    updated_at: nowIso(mission.updated_at),
  };
  await writeJson(missionFile(root, nextMission.mission_id), nextMission);
  return nextMission;
}

export async function upsertMission(
  root: string,
  mission: Mission,
  options: { now?: string | undefined } = {},
): Promise<Mission> {
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
            idempotencyKey: mission.ingress_key ?? undefined,
          },
        );
        return mission;
      }

      const merged: Mission = {
        ...existing,
        ...mission,
        closeout: { ...existing.closeout, ...mission.closeout },
        updated_at: nowIso(options.now),
      };
      await writeMission(root, merged);
      await appendEvent(
        root,
        "mission.updated",
        { mission_id: merged.mission_id },
        { now: options.now },
      );
      return merged;
    },
    options,
  );
}

export async function attachJobToMission(
  root: string,
  missionId: string,
  jobId: string,
  options: { now?: string | undefined } = {},
): Promise<Mission> {
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

export function missionArtifactDir(root: string, missionId: string): string {
  return path.join(runtimePath(root, "artifacts"), missionId);
}

export async function listMissionsForEpic(
  root: string,
  epicId: string,
): Promise<Mission[]> {
  const files = (await fs.readdir(runtimePath(root, "missions"))).filter(
    (file) => file.endsWith(".json"),
  );
  const missions = await Promise.all(
    files.map(async (file) =>
      readJson(
        path.join(runtimePath(root, "missions"), file),
        parseMission,
        null,
      ),
    ),
  );
  return missions
    .filter(
      (mission): mission is Mission => mission?.epic_ref.epic_id === epicId,
    )
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
}
