import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import {
  claimPreMissionRequest,
  createPendingWorkspaceRequest,
  findPendingWorkspaceRequestByThread,
  queueAfterThisFollowUp,
  readQueuedFollowUp,
  resolvePendingWorkspaceRequest,
} from "../src/lib/requests.js";
import { ensureRuntimeLayout } from "../src/lib/runtime.js";

async function makeRoot(): Promise<{
  root: string;
  obsidianRoot: string;
  projectDir: string;
  workspaceDir: string;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "co-v2-requests-"));
  const obsidianRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "co-v2-requests-obsidian-"),
  );
  const projectDir = path.join(obsidianRoot, "todo-app");
  const workspaceDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "co-v2-requests-workspace-"),
  );
  await fs.mkdir(path.join(projectDir, "_cyber-office"), { recursive: true });
  await ensureRuntimeLayout(root);
  process.env["CO_OBSIDIAN_PROJECTS_ROOT"] = obsidianRoot;
  return { root, obsidianRoot, projectDir, workspaceDir };
}

test("pre-mission request claim is idempotent for the same discord message id", async () => {
  const { root } = await makeRoot();

  const first = await claimPreMissionRequest(root, {
    source: "discord",
    eventType: "message_create",
    upstreamEventId: "msg-1",
    channelId: "channel-1",
    requestingUserId: "user-1",
  });
  const second = await claimPreMissionRequest(root, {
    source: "discord",
    eventType: "message_create",
    upstreamEventId: "msg-1",
    channelId: "channel-1",
    requestingUserId: "user-1",
  });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.key_hash, second.key_hash);
});

test("pending workspace request accepts only the original requester and rejects forbidden paths", async () => {
  const { root, projectDir, workspaceDir } = await makeRoot();
  const request = await createPendingWorkspaceRequest(root, {
    projectSlug: "todo-app",
    epicId: "epic-1",
    epicThreadId: "thread-1",
    requestingUserId: "user-1",
    sourceMessageId: "msg-1",
    originalRequest: "투두앱 만들어줘",
    outcomeKind: "code_change",
  });

  const pending = await findPendingWorkspaceRequestByThread(root, "thread-1");
  assert.equal(pending?.workspace_request_id, request.workspace_request_id);

  await assert.rejects(
    resolvePendingWorkspaceRequest(root, {
      epicThreadId: "thread-1",
      requestingUserId: "user-2",
      workspacePath: workspaceDir,
      repoRoot: root,
      projectOperationsDir: path.join(projectDir, "_cyber-office"),
    }),
    /original requester/i,
  );

  await assert.rejects(
    resolvePendingWorkspaceRequest(root, {
      epicThreadId: "thread-1",
      requestingUserId: "user-1",
      workspacePath: root,
      repoRoot: root,
      projectOperationsDir: path.join(projectDir, "_cyber-office"),
    }),
    /workspace path is forbidden/i,
  );

  const resolved = await resolvePendingWorkspaceRequest(root, {
    epicThreadId: "thread-1",
    requestingUserId: "user-1",
    workspacePath: workspaceDir,
    repoRoot: root,
    projectOperationsDir: path.join(projectDir, "_cyber-office"),
  });
  assert.equal(resolved.workspace_path, workspaceDir);
});

test("only one queued after-this follow-up is kept per epic thread", async () => {
  const { root } = await makeRoot();

  await queueAfterThisFollowUp(root, {
    epicThreadId: "thread-1",
    requestingUserId: "user-1",
    requestText: "after-this: 로그인 화면 다듬기",
  });
  await queueAfterThisFollowUp(root, {
    epicThreadId: "thread-1",
    requestingUserId: "user-1",
    requestText: "after-this: 설정 화면 다듬기",
  });

  const queued = await readQueuedFollowUp(root, "thread-1");
  assert.ok(queued);
  assert.equal(queued.request_text, "설정 화면 다듬기");
});
