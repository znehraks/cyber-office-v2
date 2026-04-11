import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { buildFollowUpReply } from "../src/lib/follow-up.js";
import { createJob, transitionJobStatus } from "../src/lib/jobs.js";
import {
  createMission,
  readMission,
  writeMission,
} from "../src/lib/missions.js";
import { recordReport } from "../src/lib/reporting.js";
import { ensureRuntimeLayout } from "../src/lib/runtime.js";
import { bindThreadMission } from "../src/lib/thread-missions.js";

async function makeRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "co-v2-follow-up-"));
  await ensureRuntimeLayout(root);
  return root;
}

test("follow-up in an active thread returns a status briefing without creating a new mission", async () => {
  const root = await makeRoot();
  const mission = createMission({
    missionId: "mission-follow-up",
    ingressKey: "v1:discord:message_create:follow-up",
    threadRef: { chatId: "thread-42", messageId: "msg-1" },
    userRequest: "로그인 이슈를 조사해줘",
    category: "research",
    priorityFloor: "P1",
  });
  await writeMission(root, mission);
  await bindThreadMission(root, "thread-42", mission.mission_id);

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
  assert.match(reply.content, /^\[진행 상태] 로그인 이슈를 조사해줘$/m);
  assert.match(reply.content, /현재 researcher \/ standard가 작업을 진행 중/);
  assert.match(
    reply.content,
    /^다음: researcher \/ standard가 조사 결과를 정리합니다\.$/m,
  );
  assert.match(reply.content, /^담당: ceo \/ standard$/m);
  assert.doesNotMatch(
    reply.content,
    /한눈요약:|요청 요지:|현재 단계:|단계 전환 이유:|manifest\.json/,
  );

  const missions = (
    await fs.readdir(path.join(root, "runtime", "missions"))
  ).filter((file) => file.endsWith(".json"));
  assert.equal(missions.length, 1);
});

test("follow-up lookup ignores completed missions bound to the same thread", async () => {
  const root = await makeRoot();
  const mission = createMission({
    missionId: "mission-complete",
    ingressKey: "v1:discord:message_create:complete",
    threadRef: { chatId: "thread-99", messageId: "msg-99" },
    userRequest: "결과를 정리해줘",
    category: "standard",
    priorityFloor: "P1",
  });
  mission.status = "completed";
  mission.closeout.status = "passed";
  await writeMission(root, mission);
  await bindThreadMission(root, "thread-99", mission.mission_id);

  const reply = await buildFollowUpReply(root, "thread-99");
  assert.equal(reply, null);

  const loaded = await readMission(root, mission.mission_id);
  assert.ok(loaded);
  assert.equal(loaded.status, "completed");
});
