import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { createMission, writeMission } from "../src/lib/missions.js";
import { recordReport } from "../src/lib/reporting.js";
import { ensureRuntimeLayout } from "../src/lib/runtime.js";

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
    stage: "요청 검토",
    role: "ceo",
    tier: "standard",
    requestSummary:
      "로그인 이슈를 조사하고 결과와 다음 조치를 정리하는 작업입니다.",
    snapshot:
      "요청을 조사 중심 건으로 판단했습니다. 실행 유형과 담당 기준이 정리돼 배정 단계로 넘어갑니다.",
    completed:
      "요청 내용을 실행 가능한 작업으로 정리하고 mission을 등록했습니다.",
    transitionReason:
      "실행 유형과 담당 판단이 끝났기 때문에 바로 담당 배정 단계로 이어질 수 있습니다.",
    next: "researcher / standard 담당 기준으로 작업 범위와 책임을 확정합니다.",
    evidence: null,
  });

  const second = await recordReport(root, {
    missionId: mission.mission_id,
    reportKey: "mission.created",
    stage: "요청 검토",
    role: "ceo",
    tier: "standard",
    requestSummary:
      "로그인 이슈를 조사하고 결과와 다음 조치를 정리하는 작업입니다.",
    snapshot:
      "요청을 조사 중심 건으로 판단했습니다. 실행 유형과 담당 기준이 정리돼 배정 단계로 넘어갑니다.",
    completed:
      "요청 내용을 실행 가능한 작업으로 정리하고 mission을 등록했습니다.",
    transitionReason:
      "실행 유형과 담당 판단이 끝났기 때문에 바로 담당 배정 단계로 이어질 수 있습니다.",
    next: "researcher / standard 담당 기준으로 작업 범위와 책임을 확정합니다.",
    evidence: null,
  });

  assert.equal(first.reportId, second.reportId);
  assert.equal(second.duplicate, true);

  const reports = await fs.readdir(
    path.join(root, "runtime", "state", "reports"),
  );
  assert.equal(reports.length, 1);
  assert.equal(
    first.request_summary,
    "로그인 이슈를 조사하고 결과와 다음 조치를 정리하는 작업입니다.",
  );
  assert.equal(first.evidence, null);
  assert.match(first.content, /^한눈요약: /m);
  assert.match(first.content, /^요청 요지: /m);
  assert.match(first.content, /^현재 단계: 요청 검토$/m);
  assert.match(first.content, /^방금 진행한 내용: /m);
  assert.match(first.content, /^단계 전환 이유: /m);
  assert.match(first.content, /^다음 조치: /m);
  assert.match(first.content, /^담당: ceo \/ standard$/m);
  assert.doesNotMatch(
    first.content,
    /요청 잘 받았습니다|진행 상황을 이어서 공유드릴게요|작업이 잘 마무리되어/,
  );
});
