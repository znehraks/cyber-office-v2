import * as fs from "node:fs/promises";
import * as path from "node:path";

import type {
  OutcomeKind,
  PendingWorkspaceRequest,
  PreMissionClaim,
  QueuedFollowUp,
} from "../types/domain.js";
import {
  parsePendingWorkspaceRequest,
  parsePreMissionClaim,
  parseQueuedFollowUp,
} from "../types/domain.js";
import {
  createStampedId,
  hashValue,
  nowIso,
  openExclusive,
  readJson,
  runtimePath,
  writeJson,
} from "./runtime.js";

function preMissionClaimFile(root: string, keyHash: string): string {
  return runtimePath(root, "state", "pre-mission-claims", `${keyHash}.json`);
}

function pendingWorkspaceFile(root: string, epicThreadId: string): string {
  return runtimePath(
    root,
    "state",
    "pending-workspace-requests",
    `${hashValue(epicThreadId)}.json`,
  );
}

function queuedFollowUpFile(root: string, epicThreadId: string): string {
  return runtimePath(
    root,
    "state",
    "queued-followups",
    `${hashValue(epicThreadId)}.json`,
  );
}

function isSubPath(targetPath: string, basePath: string): boolean {
  const relative = path.relative(basePath, targetPath);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

export function createPreMissionKey(input: {
  source: string;
  eventType: string;
  upstreamEventId: string;
}): string {
  return `v1:${input.source}:${input.eventType}:${input.upstreamEventId}`;
}

export async function claimPreMissionRequest(
  root: string,
  input: {
    source: string;
    eventType: string;
    upstreamEventId: string;
    channelId: string;
    requestingUserId: string;
    now?: string | undefined;
  },
): Promise<PreMissionClaim & { created: boolean }> {
  const createdAt = nowIso(input.now);
  const canonicalKey = createPreMissionKey(input);
  const keyHash = hashValue(canonicalKey);
  const claim: PreMissionClaim = {
    canonical_key: canonicalKey,
    key_hash: keyHash,
    source: input.source,
    event_type: input.eventType,
    upstream_event_id: input.upstreamEventId,
    channel_id: input.channelId,
    requesting_user_id: input.requestingUserId,
    status: "claimed",
    created_at: createdAt,
    updated_at: createdAt,
    workspace_request_id: null,
    mission_id: null,
  };

  try {
    const handle = await openExclusive(preMissionClaimFile(root, keyHash));
    await handle.writeFile(`${JSON.stringify(claim, null, 2)}\n`, "utf8");
    await handle.close();
    return { ...claim, created: true };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      const existing = await readJson(
        preMissionClaimFile(root, keyHash),
        parsePreMissionClaim,
      );
      return { ...existing, created: false };
    }
    throw error;
  }
}

export async function updatePreMissionClaim(
  root: string,
  keyHash: string,
  patch: Partial<PreMissionClaim>,
): Promise<PreMissionClaim> {
  const filePath = preMissionClaimFile(root, keyHash);
  const current = await readJson(filePath, parsePreMissionClaim);
  const next: PreMissionClaim = {
    ...current,
    ...patch,
    updated_at: nowIso(),
  };
  await writeJson(filePath, next);
  return next;
}

export async function createPendingWorkspaceRequest(
  root: string,
  input: {
    projectSlug: string;
    epicId: string;
    epicThreadId: string;
    requestingUserId: string;
    sourceMessageId: string;
    originalRequest: string;
    outcomeKind: OutcomeKind;
    now?: string | undefined;
  },
): Promise<PendingWorkspaceRequest> {
  const existing = await findPendingWorkspaceRequestByThread(
    root,
    input.epicThreadId,
    input.now,
  );
  if (existing && existing.source_message_id !== input.sourceMessageId) {
    throw new Error(
      "A workspace resolution is already pending for this epic thread",
    );
  }
  if (existing) {
    return existing;
  }

  const requestedAt = nowIso(input.now);
  const request: PendingWorkspaceRequest = {
    workspace_request_id: createStampedId(
      "workspace-request",
      `${input.epicThreadId}:${input.sourceMessageId}`,
      requestedAt,
    ),
    project_slug: input.projectSlug,
    epic_id: input.epicId,
    epic_thread_id: input.epicThreadId,
    requesting_user_id: input.requestingUserId,
    source_message_id: input.sourceMessageId,
    original_request: input.originalRequest,
    outcome_kind: input.outcomeKind,
    status: "pending",
    workspace_path: null,
    requested_at: requestedAt,
    expires_at: new Date(Date.parse(requestedAt) + 10 * 60_000).toISOString(),
    updated_at: requestedAt,
  };
  await writeJson(pendingWorkspaceFile(root, input.epicThreadId), request);
  return request;
}

export async function findPendingWorkspaceRequestByThread(
  root: string,
  epicThreadId: string,
  now?: string | undefined,
): Promise<PendingWorkspaceRequest | null> {
  const filePath = pendingWorkspaceFile(root, epicThreadId);
  const pending = await readJson(filePath, parsePendingWorkspaceRequest, null);
  if (!pending || pending.status !== "pending") {
    return null;
  }
  if (Date.parse(pending.expires_at) <= Date.parse(nowIso(now))) {
    const expired: PendingWorkspaceRequest = {
      ...pending,
      status: "expired",
      updated_at: nowIso(now),
    };
    await writeJson(filePath, expired);
    return null;
  }
  return pending;
}

function assertWorkspacePathAllowed(input: {
  workspacePath: string;
  repoRoot: string;
  obsidianProjectsRoot?: string | undefined;
  projectOperationsDir: string;
}): void {
  if (!path.isAbsolute(input.workspacePath)) {
    throw new Error("workspace path must be absolute");
  }
  const normalizedWorkspace = path.resolve(input.workspacePath);
  const normalizedRepo = path.resolve(input.repoRoot);
  const normalizedProjectOps = path.resolve(input.projectOperationsDir);

  if (
    isSubPath(normalizedWorkspace, normalizedRepo) ||
    isSubPath(normalizedWorkspace, normalizedProjectOps)
  ) {
    throw new Error("workspace path is forbidden");
  }

  if (input.obsidianProjectsRoot) {
    const normalizedObsidian = path.resolve(input.obsidianProjectsRoot);
    if (isSubPath(normalizedWorkspace, normalizedObsidian)) {
      throw new Error("workspace path is forbidden");
    }
  }
}

export async function resolvePendingWorkspaceRequest(
  root: string,
  input: {
    epicThreadId: string;
    requestingUserId: string;
    workspacePath: string;
    repoRoot: string;
    projectOperationsDir: string;
    obsidianProjectsRoot?: string | undefined;
    now?: string | undefined;
  },
): Promise<PendingWorkspaceRequest> {
  const filePath = pendingWorkspaceFile(root, input.epicThreadId);
  const pending = await findPendingWorkspaceRequestByThread(
    root,
    input.epicThreadId,
    input.now,
  );
  if (!pending) {
    throw new Error("No pending workspace request for this epic thread");
  }
  if (pending.requesting_user_id !== input.requestingUserId) {
    throw new Error(
      "Only the original requester can provide the workspace path",
    );
  }

  assertWorkspacePathAllowed({
    workspacePath: input.workspacePath,
    repoRoot: input.repoRoot,
    projectOperationsDir: input.projectOperationsDir,
    obsidianProjectsRoot: input.obsidianProjectsRoot,
  });
  const stats = await fs.stat(input.workspacePath);
  if (!stats.isDirectory()) {
    throw new Error("workspace path must point to a directory");
  }

  const resolved: PendingWorkspaceRequest = {
    ...pending,
    status: "resolved",
    workspace_path: path.resolve(input.workspacePath),
    updated_at: nowIso(input.now),
  };
  await writeJson(filePath, resolved);
  return resolved;
}

export async function clearPendingWorkspaceRequest(
  root: string,
  epicThreadId: string,
): Promise<void> {
  await fs.rm(pendingWorkspaceFile(root, epicThreadId), { force: true });
}

export async function queueAfterThisFollowUp(
  root: string,
  input: {
    epicThreadId: string;
    requestingUserId: string;
    requestText: string;
    now?: string | undefined;
  },
): Promise<QueuedFollowUp> {
  const queuedAt = nowIso(input.now);
  const requestText = input.requestText.replace(/^after-this:\s*/iu, "").trim();
  const queued: QueuedFollowUp = {
    epic_thread_id: input.epicThreadId,
    requesting_user_id: input.requestingUserId,
    request_text: requestText,
    queued_at: queuedAt,
    updated_at: queuedAt,
  };
  await writeJson(queuedFollowUpFile(root, input.epicThreadId), queued);
  return queued;
}

export async function readQueuedFollowUp(
  root: string,
  epicThreadId: string,
): Promise<QueuedFollowUp | null> {
  return readJson(
    queuedFollowUpFile(root, epicThreadId),
    parseQueuedFollowUp,
    null,
  );
}

export async function clearQueuedFollowUp(
  root: string,
  epicThreadId: string,
): Promise<void> {
  await fs.rm(queuedFollowUpFile(root, epicThreadId), { force: true });
}
