import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type {
  Mission,
  PacketManifest,
  ProjectRef,
  RoutingDecision,
  SmokeOptions,
} from "../types/domain.js";
import {
  buildHandoffCompletedReport,
  buildJobRoutedReport,
  buildMissionCompletedReport,
  buildMissionCreatedReport,
  buildRetryReviewReport,
  createRequestBrief,
  createRequestSummary,
} from "./ceo-reporting.js";
import { verifyMissionCloseout } from "./closeout.js";
import { bindEpicMission, createEpicRecord } from "./epics.js";
import { ingestIngressEvent } from "./ingress.js";
import { createJob, writePacket } from "./jobs.js";
import { readMission, writeMission } from "./missions.js";
import { writeEpicOverviewNote, writeMissionCanonicalNote } from "./notes.js";
import { recordReport } from "./reporting.js";
import { canonicalDeliverableFileName, readResultFile } from "./results.js";
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
    outcome_kind: "research_brief",
    canonical_deliverable_name: canonicalDeliverableFileName("research_brief"),
  };
}

async function writeCloseoutArtifacts(
  root: string,
  mission: Mission,
): Promise<void> {
  const artifactDir = runtimePath(root, "artifacts", mission.mission_id);
  await fs.mkdir(artifactDir, { recursive: true });
  const missionNote = await writeMissionCanonicalNote(root, mission, {
    summaryBody: "# summary\n\nsmoke complete\n",
    completedItems: ["- runtime harness smoke"],
    nextSteps: ["- discord wiring"],
  });
  await writeEpicOverviewNote(root, mission);
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
        obsidian_note_ref: missionNote,
        completed_items: ["runtime harness smoke"],
        next_steps: ["discord wiring"],
      },
      null,
      2,
    ),
    "utf8",
  );
  await fs.writeFile(
    path.join(artifactDir, "RESEARCH.md"),
    "# Research\n\n## Key Findings\n\n- smoke 1\n- smoke 2\n- smoke 3\n\n## Recommended Next Steps\n\n- discord wiring\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(artifactDir, "result.json"),
    JSON.stringify(
      {
        outcome_kind: "research_brief",
        result_summary:
          "런타임 스모크 경로를 점검하고 핵심 산출물을 확인했습니다.",
        completed_items: ["runtime harness smoke", "closeout docs"],
        remaining_work: ["discord wiring"],
        risks: [],
        deliverable_refs: [path.join(artifactDir, "RESEARCH.md")],
        key_findings: ["smoke 1", "smoke 2", "smoke 3"],
        recommended_next_steps: ["discord wiring"],
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function makeSmokeProjectRef(): Promise<ProjectRef> {
  const obsidianRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "co-v2-smoke-projects-"),
  );
  const projectDir = path.join(obsidianRoot, "smoke-project");
  await fs.mkdir(projectDir, { recursive: true });
  return {
    project_slug: "smoke-project",
    display_name: "Smoke Project",
    discord_channel_id: "smoke-channel",
    obsidian_rel_dir: "smoke-project",
    obsidian_project_dir: projectDir,
  };
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
  const projectRef = await makeSmokeProjectRef();
  const epicRef = await createEpicRecord(root, {
    projectSlug: projectRef.project_slug,
    title: "smoke epic",
    discordThreadId: "smoke-thread",
    obsidianNoteRef: path.join(
      projectRef.obsidian_project_dir,
      "_cyber-office",
      "epics",
      "smoke-epic",
      "EPIC.md",
    ),
    now: options.now,
  });
  const ingress = await ingestIngressEvent(root, {
    source: "discord",
    eventType: "message_create",
    upstreamEventId: messageId,
    threadRef: { chatId: "smoke-thread", messageId },
    projectRef,
    epicRef,
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
  const boundEpic = await bindEpicMission(
    root,
    epicRef.epic_id,
    mission.mission_id,
    {
      now: options.now,
    },
  );
  mission.epic_ref = boundEpic;
  await writeMission(root, mission);
  await writeMissionCanonicalNote(root, mission);
  await writeEpicOverviewNote(root, mission);
  const requestSummary = createRequestSummary(mission.user_request);
  const requestBrief = createRequestBrief(mission.user_request);
  const routing: RoutingDecision = {
    category: "research",
    worker: "researcher",
    tier: "standard",
    rationale: "smoke route",
  };

  const report = await recordReport(root, {
    missionId: mission.mission_id,
    reportKey: "mission.created",
    role: "ceo",
    tier: "standard",
    requestBrief,
    ...buildMissionCreatedReport(requestSummary, routing),
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
    role: "ceo",
    tier: "standard",
    requestBrief,
    ...buildJobRoutedReport(requestSummary, routing, job.packet_ref),
  });

  await writePacket(root, job.job_id, buildPacket(root, job.job_id, inputRef));

  const worker = await runWorker(root, job.worker, job.job_id, {
    claudeBin: options.claudeBin,
    extraArgs: options.extraArgs,
    now: options.now,
  });
  const result = await readResultFile(worker.artifactDir);

  await recordReport(root, {
    missionId: mission.mission_id,
    reportKey: "handoff.completed",
    role: "ceo",
    tier: "standard",
    requestBrief,
    ...buildHandoffCompletedReport(requestSummary, result),
  });

  await recordReport(root, {
    missionId: mission.mission_id,
    reportKey: "job.retried",
    role: "ceo",
    tier: "standard",
    requestBrief,
    ...buildRetryReviewReport({
      requestSummary,
      retryRequired: false,
    }),
  });

  await writeCloseoutArtifacts(root, mission);

  await recordReport(root, {
    missionId: mission.mission_id,
    reportKey: "mission.completed",
    role: "ceo",
    tier: "standard",
    requestBrief,
    ...buildMissionCompletedReport(requestSummary),
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
