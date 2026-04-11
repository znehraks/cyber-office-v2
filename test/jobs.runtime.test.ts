import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { bootstrapRuntimeWorkers } from "../src/lib/bootstrap.js";
import {
  createJob,
  readJob,
  transitionJobStatus,
  writePacket,
} from "../src/lib/jobs.js";
import { createMission, writeMission } from "../src/lib/missions.js";
import { ensureRuntimeLayout } from "../src/lib/runtime.js";

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "co-v2-jobs-"));
  await ensureRuntimeLayout(root);
  await bootstrapRuntimeWorkers(root);
  return root;
}

async function seedMission(root: string, missionId = "mission-jobs-1") {
  const mission = createMission({
    missionId,
    ingressKey: `manual:${missionId}`,
    userRequest: "jobs test",
    category: "standard",
    priorityFloor: "P1",
  });
  await writeMission(root, mission);
  return mission;
}

test("createJob is idempotent for the same job_key", async () => {
  const root = await makeRoot();
  const mission = await seedMission(root);

  const first = await createJob(root, {
    missionId: mission.mission_id,
    worker: "fullstack-dev",
    category: "standard",
    priority: "P1",
    task: "same task",
    deliverable: "same deliverable",
    jobKey: "mission-jobs-1:fullstack-dev:same-key",
  });
  const second = await createJob(root, {
    missionId: mission.mission_id,
    worker: "fullstack-dev",
    category: "standard",
    priority: "P1",
    task: "same task",
    deliverable: "same deliverable",
    jobKey: "mission-jobs-1:fullstack-dev:same-key",
  });

  assert.equal(first.job_id, second.job_id);

  const jobs = (await fs.readdir(path.join(root, "runtime", "jobs"))).filter(
    (file) => file.endsWith(".json"),
  );
  assert.equal(jobs.length, 1);
});

test("packet is immutable once written", async () => {
  const root = await makeRoot();
  const mission = await seedMission(root, "mission-jobs-2");
  const inputRef = path.join(root, "input.md");
  await fs.writeFile(inputRef, "# input\n", "utf8");

  const job = await createJob(root, {
    missionId: mission.mission_id,
    worker: "researcher",
    category: "research",
    priority: "P1",
    task: "write packet",
    deliverable: "summary",
  });

  const packet = {
    required_refs: [inputRef],
    optional_refs: [],
    code_refs: [],
    acceptance_checks: ["summary exists"],
    open_questions: [],
    allowed_write_roots: [path.join(root, "runtime", "artifacts", job.job_id)],
    working_dir: root,
  };

  await writePacket(root, job.job_id, packet);

  await assert.rejects(
    writePacket(root, job.job_id, {
      ...packet,
      acceptance_checks: ["different"],
    }),
    /immutable/,
  );
});

test("transitionJobStatus rejects invalid compare-and-swap transitions", async () => {
  const root = await makeRoot();
  const mission = await seedMission(root, "mission-jobs-3");
  const job = await createJob(root, {
    missionId: mission.mission_id,
    worker: "qa",
    category: "standard",
    priority: "P1",
    task: "cas transition",
    deliverable: "summary",
  });

  const first = await transitionJobStatus(
    root,
    job.job_id,
    ["queued"],
    "running",
  );
  assert.equal(first.changed, true);
  assert.equal(first.job.status, "running");

  const second = await transitionJobStatus(
    root,
    job.job_id,
    ["queued"],
    "completed",
  );
  assert.equal(second.changed, false);
  assert.equal(second.job.status, "running");

  const persisted = await readJob(root, job.job_id);
  assert.ok(persisted);
  assert.equal(persisted.status, "running");
});
