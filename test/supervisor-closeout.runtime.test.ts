import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { verifyMissionCloseout } from "../src/lib/closeout.js";
import { createJob, readJob } from "../src/lib/jobs.js";
import {
  createMission,
  readMission,
  writeMission,
} from "../src/lib/missions.js";
import { recordReport } from "../src/lib/reporting.js";
import { ensureRuntimeLayout } from "../src/lib/runtime.js";
import {
  acquireSupervisorLease,
  supervisorTick,
} from "../src/lib/supervisor.js";

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "co-v2-supervisor-"));
  await ensureRuntimeLayout(root);
  return root;
}

test("supervisor only creates one retry attempt for the same stalled job", async () => {
  const root = await makeRoot();
  const mission = createMission({
    missionId: "mission-3",
    ingressKey: "v1:discord:message_create:3",
    userRequest: "재시도 검사",
    category: "standard",
    priorityFloor: "P1",
  });
  await writeMission(root, mission);

  const job = await createJob(root, {
    missionId: mission.mission_id,
    worker: "fullstack-dev",
    category: "standard",
    priority: "P1",
    task: "오래 걸리는 작업",
    deliverable: "summary.md 작성",
  });

  const staleHeartbeat = "2026-04-10T09:00:00.000Z";
  await fs.writeFile(
    path.join(root, "runtime", "jobs", `${job.job_id}.json`),
    JSON.stringify(
      {
        ...job,
        status: "running",
        started_at: staleHeartbeat,
        heartbeat_at: staleHeartbeat,
        progress_at: staleHeartbeat,
      },
      null,
      2,
    ),
    "utf8",
  );

  await acquireSupervisorLease(root, {
    ownerPid: "pid-1",
    now: "2026-04-10T09:10:00.000Z",
  });

  const first = await supervisorTick(root, {
    ownerPid: "pid-1",
    now: "2026-04-10T09:10:00.000Z",
  });
  const second = await supervisorTick(root, {
    ownerPid: "pid-1",
    now: "2026-04-10T09:10:01.000Z",
  });

  assert.equal(first.retried.length, 1);
  assert.equal(second.retried.length, 0);

  const jobs = await fs.readdir(path.join(root, "runtime", "jobs"));
  assert.equal(jobs.length, 2);
});

test("stale supervisor lease can be taken over by a new owner", async () => {
  const root = await makeRoot();

  await acquireSupervisorLease(root, {
    ownerPid: "pid-old",
    now: "2026-04-10T09:00:00.000Z",
    leaseMs: 30_000,
  });

  const renewed = await acquireSupervisorLease(root, {
    ownerPid: "pid-new",
    now: "2026-04-10T09:02:00.000Z",
    leaseMs: 30_000,
  });

  assert.equal(renewed.owner_pid, "pid-new");
  assert.equal(renewed.taken_over, true);
});

test("dead supervisor pid can be taken over before lease expiry", async () => {
  const root = await makeRoot();

  await acquireSupervisorLease(root, {
    ownerPid: "1001",
    now: "2026-04-10T09:00:00.000Z",
    leaseMs: 300_000,
    isOwnerAlive: () => true,
  });

  const renewed = await acquireSupervisorLease(root, {
    ownerPid: "2002",
    now: "2026-04-10T09:01:00.000Z",
    leaseMs: 300_000,
    isOwnerAlive: (ownerPid) => ownerPid !== "1001",
  });

  assert.equal(renewed.owner_pid, "2002");
  assert.equal(renewed.taken_over, true);
});

test("mission closeout is blocked by unresolved P1 backlog and passes once cleared", async () => {
  const root = await makeRoot();
  const mission = createMission({
    missionId: "mission-4",
    ingressKey: "v1:discord:message_create:4",
    userRequest: "마감 검증",
    category: "standard",
    priorityFloor: "P1",
  });
  mission.backlog = [
    { id: "item-1", title: "핵심 버그", priority: "P1", status: "open" },
  ];
  await writeMission(root, mission);

  const artifactDir = path.join(
    root,
    "runtime",
    "artifacts",
    mission.mission_id,
  );
  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(
    path.join(artifactDir, "STATUS.md"),
    "# 현재 상태\n\n완료\n\n# 이번 세션에서 완료한 것\n\n- 구현\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(artifactDir, "NEXT-STEPS.md"),
    "# 다음 우선순위\n\n- 없음\n\n# 재개 순서\n\n- 없음\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(artifactDir, "closeout.json"),
    JSON.stringify(
      {
        status: "complete",
        obsidian_note_ref: "/tmp/obsidian-note.md",
        completed_items: ["구현"],
        next_steps: [],
      },
      null,
      2,
    ),
    "utf8",
  );

  await assert.rejects(verifyMissionCloseout(root, mission.mission_id), /P1/);

  const loaded = await readMission(root, mission.mission_id);
  assert.ok(loaded);
  loaded.backlog = [
    { id: "item-1", title: "핵심 버그", priority: "P1", status: "done" },
  ];
  await writeMission(root, loaded);

  for (const reportKey of loaded.closeout.required_reports) {
    await recordReport(root, {
      missionId: mission.mission_id,
      reportKey,
      stage: reportKey,
      role: "ceo",
      tier: "standard",
      requestBrief: "closeout 검증",
      requestSummary:
        "closeout 필수 보고 충족 여부를 정리하는 테스트 작업입니다.",
      snapshot: `${reportKey} 보고가 기록됐고 closeout 검증 조건을 맞추는 중입니다.`,
      completed: `${reportKey} emitted`,
      transitionReason:
        "필수 보고 항목을 채워 closeout 검증을 통과할 수 있게 합니다.",
      next: "n/a",
      evidence: null,
    });
  }

  const result = await verifyMissionCloseout(root, mission.mission_id);
  assert.equal(result.status, "passed");
});
