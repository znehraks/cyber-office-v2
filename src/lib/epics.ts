import * as fs from "node:fs/promises";
import * as path from "node:path";

import type {
  EpicRecord,
  EpicSlugIndex,
  EpicStatus,
  EpicThreadIndex,
  PendingEpicResolution,
  PendingEpicResolutionCandidate,
} from "../types/domain.js";
import {
  parseEpicRecord,
  parseEpicSlugIndex,
  parseEpicThreadIndex,
  parsePendingEpicResolution,
} from "../types/domain.js";
import { appendEvent } from "./events.js";
import {
  createStampedId,
  hashValue,
  nowIso,
  readJson,
  runtimePath,
  safeUnlink,
  withResourceLock,
  writeJson,
} from "./runtime.js";

interface CreateEpicInput {
  projectSlug: string;
  title: string;
  discordThreadId: string;
  status?: EpicStatus | undefined;
  epicId?: string | undefined;
  obsidianNoteRef?: string | undefined;
  now?: string | undefined;
}

export type EpicResolutionResult =
  | {
      kind: "exact";
      epic: EpicRecord;
    }
  | {
      kind: "candidates";
      candidates: EpicRecord[];
    }
  | {
      kind: "new";
      slug: string;
    };

interface ResolveEpicRequestInput {
  projectSlug: string;
  title: string;
}

interface PendingResolutionLookup {
  channelId: string;
  requestingUserId: string;
  now?: string | undefined;
}

interface CreatePendingEpicResolutionInput {
  projectSlug: string;
  channelId: string;
  sourceMessageId: string;
  requestingUserId: string;
  epicTitle?: string | undefined;
  requestBody?: string | undefined;
  requestText: string;
  candidates: EpicRecord[];
  now?: string | undefined;
}

function epicFile(root: string, epicId: string): string {
  return runtimePath(root, "epics", `${epicId}.json`);
}

function epicThreadIndexFile(root: string, discordThreadId: string): string {
  return runtimePath(
    root,
    "state",
    "epic-threads",
    `${hashValue(discordThreadId)}.json`,
  );
}

function epicSlugIndexFile(
  root: string,
  projectSlug: string,
  epicSlug: string,
): string {
  return runtimePath(
    root,
    "state",
    "epic-slugs",
    `${hashValue(`${projectSlug}:${epicSlug}`)}.json`,
  );
}

function pendingResolutionFile(
  root: string,
  channelId: string,
  requestingUserId: string,
): string {
  return runtimePath(
    root,
    "state",
    "pending-epic-resolutions",
    `${hashValue(`${channelId}:${requestingUserId}`)}.json`,
  );
}

function tokenizeSlug(value: string): string[] {
  return value.split("-").filter((token) => token !== "");
}

function levenshteinDistance(left: string, right: string): number {
  const cols = right.length + 1;
  let previous = Array.from({ length: cols }, (_, index) => index);

  for (let col = 0; col < cols; col += 1) {
    previous[col] = col;
  }

  for (let row = 1; row <= left.length; row += 1) {
    const current = Array<number>(cols).fill(0);
    current[0] = row;
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      current[col] = Math.min(
        (previous[col] ?? 0) + 1,
        (current[col - 1] ?? 0) + 1,
        (previous[col - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }

  return previous[right.length] ?? 0;
}

function scoreEpicSimilarity(requestSlug: string, epicSlug: string): number {
  const requestTokens = new Set(tokenizeSlug(requestSlug));
  const epicTokens = new Set(tokenizeSlug(epicSlug));
  const shared = [...requestTokens].filter((token) => epicTokens.has(token));
  const tokenScore =
    requestTokens.size === 0 && epicTokens.size === 0
      ? 1
      : (shared.length * 2) / (requestTokens.size + epicTokens.size);
  const maxLength = Math.max(requestSlug.length, epicSlug.length, 1);
  const editScore = 1 - levenshteinDistance(requestSlug, epicSlug) / maxLength;
  return tokenScore * 0.6 + editScore * 0.4;
}

export function normalizeEpicTitle(title: string): string {
  const normalized = title.normalize("NFKC").trim().toLowerCase();
  const compact = normalized.replace(/[\s_]+/gu, "-");
  const safe = compact.replace(/[^\p{L}\p{N}-]+/gu, "-");
  const collapsed = safe.replace(/-+/gu, "-");
  return collapsed.replace(/^-+|-+$/gu, "");
}

export async function readEpic(
  root: string,
  epicId: string,
): Promise<EpicRecord | null> {
  return readJson(epicFile(root, epicId), parseEpicRecord, null);
}

async function writeEpicIndexes(root: string, epic: EpicRecord): Promise<void> {
  const threadIndex: EpicThreadIndex = {
    discord_thread_id: epic.discord_thread_id,
    epic_id: epic.epic_id,
    updated_at: epic.updated_at,
  };
  const slugIndex: EpicSlugIndex = {
    project_slug: epic.project_slug,
    epic_slug: epic.slug,
    epic_id: epic.epic_id,
    updated_at: epic.updated_at,
  };
  await Promise.all([
    writeJson(epicThreadIndexFile(root, epic.discord_thread_id), threadIndex),
    writeJson(epicSlugIndexFile(root, epic.project_slug, epic.slug), slugIndex),
  ]);
}

export async function writeEpic(
  root: string,
  epic: EpicRecord,
): Promise<EpicRecord> {
  await writeJson(epicFile(root, epic.epic_id), epic);
  await writeEpicIndexes(root, epic);
  return epic;
}

export async function createEpicRecord(
  root: string,
  input: CreateEpicInput,
): Promise<EpicRecord> {
  const createdAt = nowIso(input.now);
  const slug = normalizeEpicTitle(input.title);
  const epic: EpicRecord = {
    epic_id:
      input.epicId ??
      createStampedId("epic", `${input.projectSlug}:${slug}`, createdAt),
    project_slug: input.projectSlug,
    title: input.title.trim(),
    slug,
    discord_thread_id: input.discordThreadId,
    status: input.status ?? "open",
    active_mission_id: null,
    obsidian_note_ref: input.obsidianNoteRef ?? "",
    created_at: createdAt,
    updated_at: createdAt,
  };
  await writeEpic(root, epic);
  await appendEvent(
    root,
    "epic.created",
    {
      epic_id: epic.epic_id,
      project_slug: epic.project_slug,
      discord_thread_id: epic.discord_thread_id,
      slug: epic.slug,
    },
    { now: input.now, idempotencyKey: `${epic.project_slug}:${epic.slug}` },
  );
  return epic;
}

async function listProjectEpics(
  root: string,
  projectSlug: string,
): Promise<EpicRecord[]> {
  const files = (await fs.readdir(runtimePath(root, "epics"))).filter((file) =>
    file.endsWith(".json"),
  );
  const epics = await Promise.all(
    files.map(async (file) =>
      readJson(
        path.join(runtimePath(root, "epics"), file),
        parseEpicRecord,
        null,
      ),
    ),
  );
  return epics
    .filter((epic): epic is EpicRecord => epic?.project_slug === projectSlug)
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
}

export async function findEpicByThreadId(
  root: string,
  discordThreadId: string,
): Promise<EpicRecord | null> {
  const index = await readJson(
    epicThreadIndexFile(root, discordThreadId),
    parseEpicThreadIndex,
    null,
  );
  if (!index) {
    return null;
  }
  return readEpic(root, index.epic_id);
}

async function findEpicBySlug(
  root: string,
  projectSlug: string,
  epicSlug: string,
): Promise<EpicRecord | null> {
  const index = await readJson(
    epicSlugIndexFile(root, projectSlug, epicSlug),
    parseEpicSlugIndex,
    null,
  );
  if (!index) {
    return null;
  }
  return readEpic(root, index.epic_id);
}

export async function resolveEpicRequest(
  root: string,
  input: ResolveEpicRequestInput,
): Promise<EpicResolutionResult> {
  const slug = normalizeEpicTitle(input.title);
  const exact = await findEpicBySlug(root, input.projectSlug, slug);
  if (exact && exact.status === "open") {
    return { kind: "exact", epic: exact };
  }

  const epics = (await listProjectEpics(root, input.projectSlug)).filter(
    (epic) => epic.status === "open",
  );
  const candidates = epics
    .map((epic) => ({
      epic,
      score: scoreEpicSimilarity(slug, epic.slug),
    }))
    .filter((entry) => entry.score >= 0.45)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map((entry) => entry.epic);

  if (candidates.length > 0) {
    return { kind: "candidates", candidates };
  }

  return { kind: "new", slug };
}

export async function bindEpicMission(
  root: string,
  epicId: string,
  missionId: string,
  options: { now?: string | undefined } = {},
): Promise<EpicRecord> {
  return withResourceLock(root, `epic-${epicId}`, async () => {
    const epic = await readEpic(root, epicId);
    if (!epic) {
      throw new Error(`Epic not found: ${epicId}`);
    }
    if (epic.active_mission_id && epic.active_mission_id !== missionId) {
      throw new Error(
        `Epic already has an active mission: ${epic.active_mission_id}`,
      );
    }
    if (epic.active_mission_id === missionId) {
      return epic;
    }

    const next: EpicRecord = {
      ...epic,
      active_mission_id: missionId,
      updated_at: nowIso(options.now),
    };
    await writeEpic(root, next);
    await appendEvent(
      root,
      "epic.active_mission.bound",
      { epic_id: epicId, mission_id: missionId },
      { now: options.now, idempotencyKey: `${epicId}:${missionId}:bound` },
    );
    return next;
  });
}

export async function clearEpicMission(
  root: string,
  epicId: string,
  missionId: string,
  options: { now?: string | undefined } = {},
): Promise<EpicRecord | null> {
  return withResourceLock(root, `epic-${epicId}`, async () => {
    const epic = await readEpic(root, epicId);
    if (!epic) {
      return null;
    }
    if (epic.active_mission_id !== missionId) {
      return epic;
    }

    const next: EpicRecord = {
      ...epic,
      active_mission_id: null,
      updated_at: nowIso(options.now),
    };
    await writeEpic(root, next);
    await appendEvent(
      root,
      "epic.active_mission.cleared",
      { epic_id: epicId, mission_id: missionId },
      { now: options.now, idempotencyKey: `${epicId}:${missionId}:cleared` },
    );
    return next;
  });
}

function toPendingCandidate(epic: EpicRecord): PendingEpicResolutionCandidate {
  return {
    epic_id: epic.epic_id,
    title: epic.title,
    slug: epic.slug,
    discord_thread_id: epic.discord_thread_id,
  };
}

export async function createPendingEpicResolution(
  root: string,
  input: CreatePendingEpicResolutionInput,
): Promise<PendingEpicResolution> {
  const existing = await findPendingEpicResolution(root, {
    channelId: input.channelId,
    requestingUserId: input.requestingUserId,
    now: input.now,
  });
  if (existing && existing.source_message_id !== input.sourceMessageId) {
    throw new Error(
      "A pending epic resolution already exists for this user in the channel",
    );
  }
  if (existing) {
    return existing;
  }

  const requestedAt = nowIso(input.now);
  const resolution: PendingEpicResolution = {
    resolution_id: createStampedId(
      "resolution",
      `${input.channelId}:${input.requestingUserId}:${input.sourceMessageId}`,
      requestedAt,
    ),
    project_slug: input.projectSlug,
    channel_id: input.channelId,
    source_message_id: input.sourceMessageId,
    requesting_user_id: input.requestingUserId,
    epic_title: input.epicTitle ?? "",
    request_body: input.requestBody ?? "",
    request_text: input.requestText,
    candidates: input.candidates.map((candidate) =>
      toPendingCandidate(candidate),
    ),
    requested_at: requestedAt,
    expires_at: new Date(Date.parse(requestedAt) + 10 * 60_000).toISOString(),
    updated_at: requestedAt,
  };
  await writeJson(
    pendingResolutionFile(root, input.channelId, input.requestingUserId),
    resolution,
  );
  await appendEvent(
    root,
    "epic.resolution.requested",
    {
      project_slug: input.projectSlug,
      channel_id: input.channelId,
      source_message_id: input.sourceMessageId,
    },
    { now: input.now, idempotencyKey: resolution.resolution_id },
  );
  return resolution;
}

export async function findPendingEpicResolution(
  root: string,
  input: PendingResolutionLookup,
): Promise<PendingEpicResolution | null> {
  const filePath = pendingResolutionFile(
    root,
    input.channelId,
    input.requestingUserId,
  );
  const pending = await readJson(filePath, parsePendingEpicResolution, null);
  if (!pending) {
    return null;
  }

  const now = Date.parse(nowIso(input.now));
  const expired = Date.parse(pending.expires_at) <= now;
  if (expired) {
    await safeUnlink(filePath);
    return null;
  }
  return pending;
}

export async function clearPendingEpicResolution(
  root: string,
  channelId: string,
  requestingUserId: string,
): Promise<void> {
  await safeUnlink(pendingResolutionFile(root, channelId, requestingUserId));
}
