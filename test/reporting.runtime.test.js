import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ensureRuntimeLayout } from "../src/lib/runtime.js";
import { createMission, writeMission } from "../src/lib/missions.js";
import { recordReport } from "../src/lib/reporting.js";

async function makeRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "co-v2-report-"));
  await ensureRuntimeLayout(root);
  return root;
}

test("duplicate report keys only emit one user-facing report", async () => {
  const root = await makeRoot();
  const mission = createMission({
    missionId: "mission-5",
    ingressKey: "v1:discord:message_create:5",
    userRequest: "보고 중복 방지",
    category: "standard",
    priorityFloor: "P1",
  });
  await writeMission(root, mission);

  const first = await recordReport(root, {
    missionId: mission.mission_id,
    reportKey: "mission.created",
    stage: "요청 접수",
    role: "ceo",
    tier: "standard",
    completed: "요청을 받아 mission 생성",
    findings: "중요 제약 없음",
    next: "researcher 배정",
  });

  const second = await recordReport(root, {
    missionId: mission.mission_id,
    reportKey: "mission.created",
    stage: "요청 접수",
    role: "ceo",
    tier: "standard",
    completed: "요청을 받아 mission 생성",
    findings: "중요 제약 없음",
    next: "researcher 배정",
  });

  assert.equal(first.reportId, second.reportId);
  assert.equal(second.duplicate, true);

  const reports = await fs.readdir(path.join(root, "runtime", "state", "reports"));
  assert.equal(reports.length, 1);
  assert.match(first.content, /요청 잘 받았습니다/);
  assert.match(first.content, /현재 단계: 요청 접수/);
});
