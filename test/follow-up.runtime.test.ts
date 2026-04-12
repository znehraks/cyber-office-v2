import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { bindEpicMission, createEpicRecord } from "../src/lib/epics.js";
import {
  buildFollowUpReply,
  handleActiveMissionThreadInput,
} from "../src/lib/follow-up.js";
import { createJob, transitionJobStatus } from "../src/lib/jobs.js";
import {
  createMission,
  readMission,
  writeMission,
} from "../src/lib/missions.js";
import { recordReport } from "../src/lib/reporting.js";
import { ensureRuntimeLayout } from "../src/lib/runtime.js";

async function makeRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "co-v2-follow-up-"));
  await ensureRuntimeLayout(root);
  return root;
}

test("follow-up in an active thread returns a status briefing without creating a new mission", async () => {
  const root = await makeRoot();
  const epic = await createEpicRecord(root, {
    projectSlug: "cyber-office-runtime",
    title: "runtime",
    discordThreadId: "thread-42",
  });
  const mission = createMission({
    missionId: "mission-follow-up",
    ingressKey: "v1:discord:message_create:follow-up",
    threadRef: { chatId: "thread-42", messageId: "msg-1" },
    epicRef: epic,
    userRequest: "로그인 이슈를 조사해줘",
    category: "research",
    priorityFloor: "P1",
  });
  await writeMission(root, mission);
  await bindEpicMission(root, epic.epic_id, mission.mission_id);

  const job = await createJob(root, {
    missionId: mission.mission_id,
    worker: "researcher",
    category: "research",
    priority: "P1",
    task: "로그인 이슈 조사",
    deliverable: "summary.md 작성",
  });
  await transitionJobStatus(root, job.job_id, ["queued"], "running");

  await recordReport(root, {
    missionId: mission.mission_id,
    reportKey: "job.routed",
    stage: "담당 배정",
    role: "ceo",
    tier: "standard",
    requestBrief: "로그인 이슈를 조사해줘",
    requestSummary:
      "로그인 이슈를 조사하고 결과와 다음 조치를 정리하는 작업입니다.",
    snapshot:
      "현재 researcher / standard 담당을 확정했고, 바로 작업을 진행할 수 있는 상태입니다.",
    completed:
      "researcher / standard 담당에 요청을 넘기고 조사 착수 조건을 정리했습니다.",
    transitionReason:
      "입력 자료와 작업 경계가 정리돼 바로 실행을 이어갈 수 있습니다.",
    next: "researcher / standard가 조사 결과를 정리합니다.",
    evidence: "/tmp/manifest.json",
  });

  const reply = await buildFollowUpReply(root, "thread-42");
  assert.ok(reply);
  assert.equal(reply.missionId, mission.mission_id);
  assert.match(reply.content, /^---$/m);
  assert.match(reply.content, /^\[진행 상태] 로그인 이슈 현재 상태$/m);
  assert.match(
    reply.content,
    /현재 researcher \/ standard가 작업을 이어가고 있습니다/,
  );
  assert.match(
    reply.content,
    /^다음: researcher \/ standard가 조사 결과를 정리합니다\.$/m,
  );
  assert.match(reply.content, /^담당: ceo \/ standard$/m);
  assert.doesNotMatch(
    reply.content,
    /한눈요약:|요청 요지:|현재 단계:|단계 전환 이유:|manifest\.json|packet/,
  );

  const missions = (
    await fs.readdir(path.join(root, "runtime", "missions"))
  ).filter((file) => file.endsWith(".json"));
  assert.equal(missions.length, 1);
});

test("follow-up status uses summary artifact to explain actual progress", async () => {
  const root = await makeRoot();
  const epic = await createEpicRecord(root, {
    projectSlug: "todo-app-e2e",
    title: "todo app",
    discordThreadId: "thread-43",
  });
  const mission = createMission({
    missionId: "mission-follow-up-summary",
    ingressKey: "v1:discord:message_create:follow-up-summary",
    threadRef: { chatId: "thread-43", messageId: "msg-43" },
    epicRef: epic,
    userRequest: "간단한 투두앱을 구현해줘",
    category: "standard",
    priorityFloor: "P1",
  });
  await writeMission(root, mission);
  await bindEpicMission(root, epic.epic_id, mission.mission_id);

  const job = await createJob(root, {
    missionId: mission.mission_id,
    worker: "app-dev",
    category: "standard",
    priority: "P1",
    task: "투두앱 구현",
    deliverable: "summary.md 작성",
  });
  await transitionJobStatus(root, job.job_id, ["queued"], "running");
  const artifactDir = path.join(root, "runtime", "artifacts", job.job_id);
  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(
    path.join(artifactDir, "summary.md"),
    "# 진행 보고\n\n## 실제 만든 것\nReact 기반 투두앱 기본 구조와 추가/토글/삭제 기능까지 구현했습니다.\n",
    "utf8",
  );

  const reply = await buildFollowUpReply(root, "thread-43");
  assert.ok(reply);
  assert.match(
    reply.content,
    /현재 app-dev \/ standard가 작업을 이어가고 있습니다/,
  );
  assert.match(
    reply.content,
    /React 기반 투두앱 기본 구조와 추가\/토글\/삭제 기능까지 구현했습니다\./,
  );
  assert.doesNotMatch(reply.content, /결과 확보 전 단계|packet/);
});

test("active mission thread only accepts status and after-this commands", async () => {
  const root = await makeRoot();
  const epic = await createEpicRecord(root, {
    projectSlug: "cyber-office-runtime",
    title: "runtime",
    discordThreadId: "thread-77",
  });
  const mission = createMission({
    missionId: "mission-active-commands",
    ingressKey: "v1:discord:message_create:active-commands",
    threadRef: { chatId: "thread-77", messageId: "msg-77" },
    epicRef: epic,
    userRequest: "대시보드 만들어줘",
    category: "standard",
    priorityFloor: "P1",
  });
  await writeMission(root, mission);
  await bindEpicMission(root, epic.epic_id, mission.mission_id);

  const rejected = await handleActiveMissionThreadInput(root, {
    threadId: "thread-77",
    requestingUserId: "user-1",
    content: "그럼 이 버튼도 바꿔줘",
  });
  assert.equal(rejected.kind, "rejected");
  assert.match(rejected.content, /`status`|`after-this:`/);

  const queued = await handleActiveMissionThreadInput(root, {
    threadId: "thread-77",
    requestingUserId: "user-1",
    content: "after-this: 버튼 카피도 수정해줘",
  });
  assert.equal(queued.kind, "queued");
  assert.match(queued.content, /현재 작업이 끝나는 즉시 이어서 처리/);
});

test("follow-up lookup ignores completed missions bound to the same thread", async () => {
  const root = await makeRoot();
  const epic = await createEpicRecord(root, {
    projectSlug: "cyber-office-runtime",
    title: "runtime",
    discordThreadId: "thread-99",
  });
  const mission = createMission({
    missionId: "mission-complete",
    ingressKey: "v1:discord:message_create:complete",
    threadRef: { chatId: "thread-99", messageId: "msg-99" },
    epicRef: epic,
    userRequest: "결과를 정리해줘",
    category: "standard",
    priorityFloor: "P1",
  });
  mission.status = "completed";
  mission.closeout.status = "passed";
  await writeMission(root, mission);
  await bindEpicMission(root, epic.epic_id, mission.mission_id);

  const reply = await buildFollowUpReply(root, "thread-99");
  assert.equal(reply, null);

  const loaded = await readMission(root, mission.mission_id);
  assert.ok(loaded);
  assert.equal(loaded.status, "completed");
});
