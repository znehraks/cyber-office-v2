import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import {
  bindEpicMission,
  clearEpicMission,
  createEpicRecord,
  createPendingEpicResolution,
  findEpicByThreadId,
  findPendingEpicResolution,
  resolveEpicRequest,
} from "../src/lib/epics.js";
import { writeProjectRegistry } from "../src/lib/projects.js";
import { ensureRuntimeLayout } from "../src/lib/runtime.js";

async function makeRoot(): Promise<{
  root: string;
  obsidianRoot: string;
  projectDir: string;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "co-v2-epics-"));
  const obsidianRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "co-v2-obsidian-"),
  );
  const projectDir = path.join(obsidianRoot, "sns-app");
  await fs.mkdir(projectDir, { recursive: true });
  process.env["CO_OBSIDIAN_PROJECTS_ROOT"] = obsidianRoot;
  await ensureRuntimeLayout(root);
  await writeProjectRegistry(root, {
    projects: [
      {
        project_slug: "sns-app",
        display_name: "SNS App",
        discord_channel_id: "channel-sns",
        obsidian_rel_dir: "sns-app",
      },
    ],
  });
  return { root, obsidianRoot, projectDir };
}

test("resolveEpicRequest reuses an open epic on normalized exact slug match", async () => {
  const { root } = await makeRoot();
  const epic = await createEpicRecord(root, {
    projectSlug: "sns-app",
    title: "로그인 플로우",
    discordThreadId: "thread-login",
    now: "2026-04-12T00:00:00.000Z",
  });

  const resolution = await resolveEpicRequest(root, {
    projectSlug: "sns-app",
    title: "  로그인-플로우 ",
  });

  assert.equal(resolution.kind, "exact");
  if (resolution.kind === "exact") {
    assert.equal(resolution.epic.epic_id, epic.epic_id);
    assert.equal(resolution.epic.discord_thread_id, "thread-login");
  }
});

test("resolveEpicRequest returns fuzzy candidates for similar open epics without auto-binding", async () => {
  const { root } = await makeRoot();
  await createEpicRecord(root, {
    projectSlug: "sns-app",
    title: "로그인 플로우",
    discordThreadId: "thread-login",
    now: "2026-04-12T00:00:00.000Z",
  });
  await createEpicRecord(root, {
    projectSlug: "sns-app",
    title: "결제 플로우",
    discordThreadId: "thread-billing",
    status: "paused",
    now: "2026-04-12T00:00:01.000Z",
  });

  const resolution = await resolveEpicRequest(root, {
    projectSlug: "sns-app",
    title: "로그인 프로우",
  });

  assert.equal(resolution.kind, "candidates");
  if (resolution.kind === "candidates") {
    assert.equal(resolution.candidates.length, 1);
    assert.equal(resolution.candidates[0]?.title, "로그인 플로우");
    assert.equal(resolution.candidates[0]?.discord_thread_id, "thread-login");
  }
});

test("bindEpicMission allows only one active mission per epic and is idempotent for the same mission", async () => {
  const { root } = await makeRoot();
  const epic = await createEpicRecord(root, {
    projectSlug: "sns-app",
    title: "로그인 플로우",
    discordThreadId: "thread-login",
  });

  const first = await bindEpicMission(root, epic.epic_id, "mission-1");
  assert.equal(first.active_mission_id, "mission-1");

  const again = await bindEpicMission(root, epic.epic_id, "mission-1");
  assert.equal(again.active_mission_id, "mission-1");

  await assert.rejects(
    bindEpicMission(root, epic.epic_id, "mission-2"),
    /Epic already has an active mission/,
  );

  await clearEpicMission(root, epic.epic_id, "mission-1");
  const rebound = await bindEpicMission(root, epic.epic_id, "mission-2");
  assert.equal(rebound.active_mission_id, "mission-2");

  const byThread = await findEpicByThreadId(root, "thread-login");
  assert.equal(byThread?.epic_id, epic.epic_id);
});

test("pending epic resolution is scoped to channel and user and expires after ten minutes", async () => {
  const { root } = await makeRoot();
  const epic = await createEpicRecord(root, {
    projectSlug: "sns-app",
    title: "로그인 플로우",
    discordThreadId: "thread-login",
    now: "2026-04-12T00:00:00.000Z",
  });

  await createPendingEpicResolution(root, {
    projectSlug: "sns-app",
    channelId: "channel-sns",
    sourceMessageId: "msg-1",
    requestingUserId: "user-1",
    requestText: "epic: 로그인 프로우\n로그인 이슈 확인",
    candidates: [epic],
    now: "2026-04-12T00:00:00.000Z",
  });

  const pending = await findPendingEpicResolution(root, {
    channelId: "channel-sns",
    requestingUserId: "user-1",
    now: "2026-04-12T00:09:59.000Z",
  });
  assert.equal(pending?.source_message_id, "msg-1");

  const expired = await findPendingEpicResolution(root, {
    channelId: "channel-sns",
    requestingUserId: "user-1",
    now: "2026-04-12T00:10:01.000Z",
  });
  assert.equal(expired, null);
});

test("only one pending epic resolution is allowed per channel and user until resolved", async () => {
  const { root } = await makeRoot();
  const epic = await createEpicRecord(root, {
    projectSlug: "sns-app",
    title: "로그인 플로우",
    discordThreadId: "thread-login",
    now: "2026-04-12T00:00:00.000Z",
  });

  await createPendingEpicResolution(root, {
    projectSlug: "sns-app",
    channelId: "channel-sns",
    sourceMessageId: "msg-1",
    requestingUserId: "user-1",
    requestText: "epic: 로그인 프로우\n로그인 이슈 확인",
    candidates: [epic],
    now: "2026-04-12T00:00:00.000Z",
  });

  await assert.rejects(
    createPendingEpicResolution(root, {
      projectSlug: "sns-app",
      channelId: "channel-sns",
      sourceMessageId: "msg-2",
      requestingUserId: "user-1",
      requestText: "epic: 로그인 프로우2\n로그인 이슈 확인",
      candidates: [epic],
      now: "2026-04-12T00:01:00.000Z",
    }),
    /pending epic resolution already exists/i,
  );
});
