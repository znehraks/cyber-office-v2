import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { bootstrapRuntimeWorkers } from "../src/lib/bootstrap.js";
import { createJob, readJob, writePacket } from "../src/lib/jobs.js";
import { createMission, writeMission } from "../src/lib/missions.js";
import { ensureRuntimeLayout } from "../src/lib/runtime.js";
import { runWorker } from "../src/lib/worker-runner.js";

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "co-v2-worker-"));
  await ensureRuntimeLayout(root);
  await bootstrapRuntimeWorkers(root);
  return root;
}

test("run-worker refuses to start when required refs are missing", async () => {
  const root = await makeRoot();
  const mission = createMission({
    missionId: "mission-1",
    ingressKey: "v1:discord:message_create:1",
    userRequest: "조사해줘",
    category: "research",
    priorityFloor: "P1",
  });
  await writeMission(root, mission);

  const job = await createJob(root, {
    missionId: mission.mission_id,
    worker: "researcher",
    category: "research",
    priority: "P1",
    task: "무언가 조사",
    deliverable: "summary.md 작성",
  });

  await writePacket(root, job.job_id, {
    required_refs: [path.join(root, "missing.md")],
    optional_refs: [],
    code_refs: [],
    acceptance_checks: ["summary exists"],
    open_questions: [],
    allowed_write_roots: [path.join(root, "runtime", "artifacts", job.job_id)],
    working_dir: root,
  });

  await assert.rejects(
    runWorker(root, "researcher", job.job_id, {
      claudeBin: process.execPath,
      extraArgs: [path.resolve("dist/test/fixtures/fake-claude-success.js")],
    }),
    /required ref/i,
  );
});

test("run-worker fails closeout when worker exits without summary artifact", async () => {
  const root = await makeRoot();
  const mission = createMission({
    missionId: "mission-2",
    ingressKey: "v1:discord:message_create:2",
    userRequest: "구현해줘",
    category: "standard",
    priorityFloor: "P1",
  });
  await writeMission(root, mission);

  const inputRef = path.join(root, "input.md");
  await fs.writeFile(inputRef, "# input\n", "utf8");

  const job = await createJob(root, {
    missionId: mission.mission_id,
    worker: "fullstack-dev",
    category: "standard",
    priority: "P1",
    task: "무언가 구현",
    deliverable: "summary.md 작성",
  });

  await writePacket(root, job.job_id, {
    required_refs: [inputRef],
    optional_refs: [],
    code_refs: [],
    acceptance_checks: ["summary exists"],
    open_questions: [],
    allowed_write_roots: [path.join(root, "runtime", "artifacts", job.job_id)],
    working_dir: root,
  });

  await assert.rejects(
    runWorker(root, "fullstack-dev", job.job_id, {
      claudeBin: process.execPath,
      extraArgs: [path.resolve("dist/test/fixtures/fake-claude-no-summary.js")],
    }),
    /summary\.md/i,
  );

  const next = await readJob(root, job.job_id);
  assert.ok(next);
  assert.equal(next.status, "failed");
});

test("run-worker marks job failed when result.json violates the contract", async () => {
  const root = await makeRoot();
  const mission = createMission({
    missionId: "mission-4",
    ingressKey: "v1:discord:message_create:4",
    userRequest: "실패 계약 검증",
    category: "standard",
    priorityFloor: "P1",
  });
  await writeMission(root, mission);

  const inputRef = path.join(root, "input.md");
  await fs.writeFile(inputRef, "# input\n", "utf8");

  const workspaceDir = path.join(root, "workspace");
  await fs.mkdir(workspaceDir, { recursive: true });

  const job = await createJob(root, {
    missionId: mission.mission_id,
    worker: "app-dev",
    category: "standard",
    priority: "P1",
    task: "결과 계약 위반 테스트",
    deliverable: "summary.md 작성",
  });

  await writePacket(root, job.job_id, {
    required_refs: [inputRef],
    optional_refs: [],
    code_refs: [],
    acceptance_checks: ["summary exists"],
    open_questions: [],
    allowed_write_roots: [path.join(root, "runtime", "artifacts", job.job_id)],
    working_dir: workspaceDir,
    outcome_kind: "code_change",
    canonical_deliverable_name: "IMPLEMENTATION.md",
  });

  await assert.rejects(
    runWorker(root, "app-dev", job.job_id, {
      claudeBin: process.execPath,
      extraArgs: [
        path.resolve("dist/test/fixtures/fake-claude-invalid-result.js"),
      ],
    }),
    /result_summary|result\.json/i,
  );

  const next = await readJob(root, job.job_id);
  assert.ok(next);
  assert.equal(next.status, "failed");
});

test("run-worker passes acceptEdits permission mode to claude", async () => {
  const root = await makeRoot();
  const mission = createMission({
    missionId: "mission-3",
    ingressKey: "v1:discord:message_create:3",
    userRequest: "권한 모드 확인",
    category: "standard",
    priorityFloor: "P1",
  });
  await writeMission(root, mission);

  const inputRef = path.join(root, "input.md");
  await fs.writeFile(inputRef, "# input\n", "utf8");

  const job = await createJob(root, {
    missionId: mission.mission_id,
    worker: "app-dev",
    category: "standard",
    priority: "P1",
    task: "권한 모드 테스트",
    deliverable: "summary.md 작성",
  });

  await writePacket(root, job.job_id, {
    required_refs: [inputRef],
    optional_refs: [],
    code_refs: [],
    acceptance_checks: ["summary exists"],
    open_questions: [],
    allowed_write_roots: [path.join(root, "runtime", "artifacts", job.job_id)],
    working_dir: root,
  });

  const result = await runWorker(root, "app-dev", job.job_id, {
    claudeBin: process.execPath,
    extraArgs: [
      path.resolve("dist/test/fixtures/fake-claude-assert-permissions.js"),
    ],
  });

  assert.equal(result.status, "completed");
});
