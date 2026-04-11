import type { Mission, ThreadMissionBinding } from "../types/domain.js";
import { parseThreadMissionBinding } from "../types/domain.js";
import { readMission } from "./missions.js";
import {
  hashValue,
  nowIso,
  readJson,
  runtimePath,
  safeUnlink,
  withResourceLock,
  writeJson,
} from "./runtime.js";

function threadMissionFile(root: string, chatId: string): string {
  return runtimePath(
    root,
    "state",
    "thread-missions",
    `${hashValue(chatId)}.json`,
  );
}

async function readBinding(
  root: string,
  chatId: string,
): Promise<ThreadMissionBinding | null> {
  return readJson(
    threadMissionFile(root, chatId),
    parseThreadMissionBinding,
    null,
  );
}

export async function bindThreadMission(
  root: string,
  chatId: string,
  missionId: string,
  options: { now?: string | undefined } = {},
): Promise<ThreadMissionBinding> {
  return withResourceLock(
    root,
    `thread-mission-${hashValue(chatId)}`,
    async () => {
      const binding: ThreadMissionBinding = {
        chat_id: chatId,
        mission_id: missionId,
        updated_at: nowIso(options.now),
      };
      await writeJson(threadMissionFile(root, chatId), binding);
      return binding;
    },
  );
}

export async function clearThreadMission(
  root: string,
  chatId: string,
  missionId: string,
): Promise<void> {
  await withResourceLock(
    root,
    `thread-mission-${hashValue(chatId)}`,
    async () => {
      const binding = await readBinding(root, chatId);
      if (!binding || binding.mission_id !== missionId) {
        return;
      }

      await safeUnlink(threadMissionFile(root, chatId));
    },
  );
}

function isMissionActive(mission: Mission): boolean {
  return mission.status !== "completed" && mission.closeout.status !== "passed";
}

export async function findActiveThreadMission(
  root: string,
  chatId: string,
): Promise<Mission | null> {
  const binding = await readBinding(root, chatId);
  if (!binding) {
    return null;
  }

  const mission = await readMission(root, binding.mission_id);
  if (!mission || !isMissionActive(mission)) {
    await clearThreadMission(root, chatId, binding.mission_id);
    return null;
  }

  return mission;
}
