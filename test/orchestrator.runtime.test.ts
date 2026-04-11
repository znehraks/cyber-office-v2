import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { bootstrapRuntimeWorkers } from "../src/lib/bootstrap.js";
import {
  classifyRequest,
  executeMissionFlow,
  parseGodCommand,
} from "../src/lib/orchestrator.js";
import { ensureRuntimeLayout } from "../src/lib/runtime.js";

async function makeRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "co-v2-orch-"));
  await ensureRuntimeLayout(root);
  await bootstrapRuntimeWorkers(root);
  await fs.writeFile(path.join(root, "README.md"), "# runtime\n", "utf8");
  return root;
}

test("classifyRequest routes niche domains to the expected specialist roles", () => {
  assert.equal(
    classifyRequest("모바일 앱 온보딩 플로우 수정").worker,
    "app-dev",
  );
  assert.equal(
    classifyRequest("AR 필터와 WebXR 데모 설계").worker,
    "ar-xr-master",
  );
  assert.equal(classifyRequest("계약서 리스크 검토").worker, "legal-reviewer");
  assert.equal(classifyRequest("랜딩 페이지 카피 작성").worker, "writer");
  assert.equal(classifyRequest("3D 모델 최적화").worker, "3d-modeler");
});

test("executeMissionFlow completes a one-shot ceo mission with reports and closeout", async () => {
  const root = await makeRoot();
  const result = await executeMissionFlow(root, {
    source: "discord",
    messageId: "orch-1",
    chatId: "thread-1",
    request: "로그인 이슈를 조사해줘",
    claudeBin: process.execPath,
    extraArgs: [path.resolve("dist/test/fixtures/fake-claude-success.js")],
  });

  assert.equal(result.missionId.startsWith("mission-"), true);
  assert.equal(result.workerResult.status, "completed");
  assert.equal(result.closeout.status, "passed");
  assert.equal(result.routing.worker, "researcher");
  assert.deepEqual(
    result.reports.map((report) => report.stage),
    ["요청 검토", "담당 배정", "결과 확보", "마감 점검", "최종 마감"],
  );

  const combined = result.reports.map((report) => report.content).join("\n\n");
  for (const label of [
    "한눈요약",
    "요청 요지",
    "현재 단계",
    "방금 진행한 내용",
    "단계 전환 이유",
    "다음 조치",
    "담당",
  ]) {
    assert.match(combined, new RegExp(`^${label}: `, "m"));
  }

  assert.doesNotMatch(
    combined,
    /default standard|category=|clean path|verify 시작/,
  );
  assert.match(result.reports[0]?.content ?? "", /배정 단계로 넘어갑니다/);
  assert.match(result.reports[1]?.content ?? "", /작업 packet/);
  assert.match(result.reports[2]?.content ?? "", /summary\.md/);
  assert.match(result.reports[2]?.content ?? "", /closeout 문서/);
  assert.match(result.reports[3]?.content ?? "", /재시도 필요 여부/);
  assert.match(result.reports[4]?.content ?? "", /mission 완료를 확정/);
});

test("parseGodCommand recognizes admin operations and rejects freeform text", () => {
  assert.deepEqual(parseGodCommand("status"), { command: "status", args: [] });
  assert.deepEqual(parseGodCommand("doctor"), { command: "doctor", args: [] });
  assert.deepEqual(parseGodCommand("supervisor tick"), {
    command: "supervisor",
    args: ["tick"],
  });
  assert.equal(parseGodCommand("그냥 대화"), null);
});
