import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { PacketManifest, SmokeOptions } from "../types/domain.js";
import { verifyMissionCloseout } from "./closeout.js";
import { ingestIngressEvent } from "./ingress.js";
import { createJob, writePacket } from "./jobs.js";
import { readMission } from "./missions.js";
import { recordReport } from "./reporting.js";
import { runtimePath } from "./runtime.js";
import { runWorker } from "./worker-runner.js";

async function ensureSmokeInput(root: string): Promise<string> {
  const preferred = path.join(root, "README.md");
  try {
    await fs.access(preferred);
    return preferred;
  } catch {
    const generated = path.join(root, "smoke-input.md");
    await fs.writeFile(generated, "# smoke input\n\nruntime smoke\n", "utf8");
    return generated;
  }
}

function buildPacket(
  root: string,
  jobId: string,
  inputRef: string,
): PacketManifest {
  return {
    required_refs: [inputRef],
    optional_refs: [],
    code_refs: [path.join(root, "src", "cli.ts")],
    acceptance_checks: ["summary exists", "closeout docs exist"],
    open_questions: [],
    allowed_write_roots: [path.join(root, "runtime", "artifacts", jobId)],
    working_dir: root,
  };
}

async function writeCloseoutArtifacts(
  root: string,
  missionId: string,
): Promise<void> {
  const artifactDir = runtimePath(root, "artifacts", missionId);
  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(
    path.join(artifactDir, "STATUS.md"),
    "# 현재 상태\n\nsmoke complete\n\n# 이번 세션에서 완료한 것\n\n- runtime harness smoke\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(artifactDir, "NEXT-STEPS.md"),
    "# 다음 우선순위\n\n- discord wiring\n\n# 재개 순서\n\n- ceo ingress 연결\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(artifactDir, "closeout.json"),
    JSON.stringify(
      {
        status: "complete",
        obsidian_note_ref: path.join(root, "README.md"),
        completed_items: ["runtime harness smoke"],
        next_steps: ["discord wiring"],
      },
      null,
      2,
    ),
    "utf8",
  );
}

export async function runSmokeScenario(
  root: string,
  options: SmokeOptions = {},
): Promise<{
  ingress: Awaited<ReturnType<typeof ingestIngressEvent>>;
  report: Awaited<ReturnType<typeof recordReport>>;
  job: Awaited<ReturnType<typeof createJob>>;
  worker: Awaited<ReturnType<typeof runWorker>>;
  closeout: Awaited<ReturnType<typeof verifyMissionCloseout>>;
}> {
  const inputRef = await ensureSmokeInput(root);
  const messageId = options.messageId ?? `smoke-${String(Date.now())}`;
  const ingress = await ingestIngressEvent(root, {
    source: "discord",
    eventType: "message_create",
    upstreamEventId: messageId,
    threadRef: { chatId: "smoke-thread", messageId },
    userRequest: options.request ?? "smoke scenario",
    category: "standard",
    priorityFloor: "P1",
    now: options.now,
  });

  const mission = await readMission(root, ingress.missionId);
  if (!mission) {
    throw new Error(
      `Mission missing after smoke ingress: ${ingress.missionId}`,
    );
  }

  const report = await recordReport(root, {
    missionId: mission.mission_id,
    reportKey: "mission.created",
    stage: "요청 접수",
    role: "ceo",
    tier: "standard",
    completed: "smoke mission 생성",
    findings: "runtime path 정상",
    next: "job 생성",
  });

  const job = await createJob(root, {
    missionId: mission.mission_id,
    worker: "researcher",
    category: "research",
    priority: "P1",
    task: "README와 CLI 구조를 확인해 summary를 작성하라",
    deliverable: "summary.md 작성",
    constraints: ["artifact-only handoff 준수"],
    inputRefs: [inputRef],
    now: options.now,
  });

  await recordReport(root, {
    missionId: mission.mission_id,
    reportKey: "job.routed",
    stage: "worker 라우팅",
    role: "ceo",
    tier: "standard",
    completed: `${job.worker} / ${job.tier} 배정`,
    findings: "packet 생성 예정",
    next: "worker 실행",
  });

  await writePacket(root, job.job_id, buildPacket(root, job.job_id, inputRef));

  const worker = await runWorker(root, job.worker, job.job_id, {
    claudeBin: options.claudeBin,
    extraArgs: options.extraArgs,
    now: options.now,
  });

  await recordReport(root, {
    missionId: mission.mission_id,
    reportKey: "handoff.completed",
    stage: "worker 완료",
    role: "ceo",
    tier: "standard",
    completed: "summary 수집 완료",
    findings: worker.summaryPath,
    next: "closeout 검증",
  });

  await recordReport(root, {
    missionId: mission.mission_id,
    reportKey: "job.retried",
    stage: "retry 상태",
    role: "ceo",
    tier: "standard",
    completed: "retry 없음",
    findings: "clean path",
    next: "closeout 문서 생성",
  });

  await writeCloseoutArtifacts(root, mission.mission_id);

  await recordReport(root, {
    missionId: mission.mission_id,
    reportKey: "mission.completed",
    stage: "최종 완료",
    role: "ceo",
    tier: "standard",
    completed: "closeout 준비 완료",
    findings: "검증 대기",
    next: "closeout verify",
  });

  const closeout = await verifyMissionCloseout(root, mission.mission_id);

  return {
    ingress,
    report,
    job,
    worker,
    closeout,
  };
}
