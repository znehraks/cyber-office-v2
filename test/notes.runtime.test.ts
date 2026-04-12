import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { createEpicRecord } from "../src/lib/epics.js";
import { createMission, writeMission } from "../src/lib/missions.js";
import { writeEpicOverviewNote } from "../src/lib/notes.js";
import { ensureRuntimeLayout } from "../src/lib/runtime.js";

async function makeRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "co-v2-notes-"));
  await ensureRuntimeLayout(root);
  return root;
}

test("writeEpicOverviewNote preserves the first mission request as the epic goal", async () => {
  const root = await makeRoot();
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "co-v2-project-"));
  const epic = await createEpicRecord(root, {
    projectSlug: "todo-app-e2e",
    title: "투두앱 epic",
    discordThreadId: "thread-notes-1",
    obsidianNoteRef: path.join(
      projectDir,
      "_cyber-office",
      "epics",
      "todo",
      "EPIC.md",
    ),
  });

  const firstMission = createMission({
    missionId: "mission-first",
    ingressKey: "v1:discord:message_create:first",
    threadRef: { chatId: epic.discord_thread_id, messageId: "msg-first" },
    projectRef: {
      project_slug: "todo-app-e2e",
      display_name: "Todo App E2E",
      discord_channel_id: "channel-1",
      obsidian_rel_dir: "todo-app-e2e",
      obsidian_project_dir: projectDir,
    },
    epicRef: epic,
    userRequest: "간단한 투두앱을 실제 구현으로 진행해줘",
    category: "standard",
    priorityFloor: "P1",
    now: "2026-04-12T14:00:00.000Z",
  });
  firstMission.closeout.status = "passed";
  await writeMission(root, firstMission);

  const secondMission = createMission({
    missionId: "mission-second",
    ingressKey: "v1:discord:message_create:second",
    threadRef: { chatId: epic.discord_thread_id, messageId: "msg-second" },
    projectRef: firstMission.project_ref,
    epicRef: epic,
    userRequest: "완료된 투두를 일괄 삭제하는 후속 기능도 이어서 진행해줘",
    category: "standard",
    priorityFloor: "P1",
    now: "2026-04-12T14:10:00.000Z",
  });
  await writeMission(root, secondMission);

  const notePath = await writeEpicOverviewNote(root, secondMission);
  const note = await fs.readFile(notePath, "utf8");
  assert.match(note, /## epic 목표/);
  assert.match(note, /간단한 투두앱을 실제 구현으로 진행해줘/);
  assert.match(
    note,
    /mission-second: 완료된 투두를 일괄 삭제하는 후속 기능도 이어서 진행해줘/,
  );
});
