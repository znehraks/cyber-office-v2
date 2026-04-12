import * as fs from "node:fs/promises";
import * as path from "node:path";

import type {
  EpicRecord,
  ExecuteMissionOptions,
  GodCommand,
  Mission,
  PacketManifest,
  ReportRecord,
  ResultFile,
  RoutingCategory,
  RoutingDecision,
  WorkerRunResult,
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
import {
  bindEpicMission,
  clearEpicMission,
  readEpic,
  writeEpic,
} from "./epics.js";
import { ingestIngressEvent } from "./ingress.js";
import {
  createJob,
  ensureRetryJob,
  readJob,
  updateJob,
  writePacket,
} from "./jobs.js";
import { missionArtifactDir, readMission, writeMission } from "./missions.js";
import { writeEpicOverviewNote, writeMissionCanonicalNote } from "./notes.js";
import {
  ensureLocalProjectRef,
  epicNotePath,
  missionDeliverablePath,
} from "./projects.js";
import { recordReport } from "./reporting.js";
import {
  canonicalDeliverableFileName,
  classifyOutcomeKind,
  readResultFile,
} from "./results.js";
import { ROUTING_RULES, findRole } from "./roles.js";
import { resolveRepoRoot } from "./root.js";
import { createStampedId, runtimePath } from "./runtime.js";
import { runWorker } from "./worker-runner.js";

const NICHE_ROUTING: Array<{
  pattern: RegExp;
  worker: string;
  category: RoutingCategory;
}> = [
  {
    pattern: /(mobile|앱|ios|android|react native|expo)/i,
    worker: "app-dev",
    category: "standard",
  },
  {
    pattern: /(ar|vr|xr|webxr|spatial)/i,
    worker: "ar-xr-master",
    category: "standard",
  },
  {
    pattern: /(3d|glb|gltf|모델링)/i,
    worker: "3d-modeler",
    category: "standard",
  },
  {
    pattern: /(legal|계약|약관|법률|컴플라이언스)/i,
    worker: "legal-reviewer",
    category: "high-risk",
  },
  {
    pattern: /(copy|카피|문안|문서|write|writer)/i,
    worker: "writer",
    category: "quick",
  },
  {
    pattern: /(marketing|마케팅|랜딩|캠페인)/i,
    worker: "marketer",
    category: "standard",
  },
  { pattern: /(sales|영업|제안서)/i, worker: "sales", category: "standard" },
  {
    pattern: /(n8n|workflow automation|automation)/i,
    worker: "n8n-automator",
    category: "standard",
  },
  {
    pattern: /(ui|ux|디자인|와이어프레임|landing page)/i,
    worker: "ui-ux-designer",
    category: "visual",
  },
  {
    pattern: /(research|조사|분석|원인 찾)/i,
    worker: "researcher",
    category: "research",
  },
];
const repoRoot = resolveRepoRoot(import.meta.url);

function resolveWorkerExecution(
  options: ExecuteMissionOptions,
  attemptNo: number,
): {
  claudeBin?: string | undefined;
  extraArgs?: string[] | undefined;
} {
  if (options.testScenario !== "retry-once") {
    return {
      claudeBin: options.claudeBin,
      extraArgs: options.extraArgs,
    };
  }

  return {
    claudeBin: process.execPath,
    extraArgs: [
      path.join(
        repoRoot,
        "dist",
        "test",
        "fixtures",
        attemptNo === 0
          ? "fake-claude-invalid-result.js"
          : "fake-claude-success.js",
      ),
    ],
  };
}

export function classifyRequest(request: string): RoutingDecision {
  const text = request.trim();
  for (const route of NICHE_ROUTING) {
    if (route.pattern.test(text)) {
      const role = findRole(route.worker);
      return {
        category: route.category,
        worker: route.worker,
        tier: role.tier,
        rationale: `matched ${route.pattern.toString()}`,
      };
    }
  }

  const lower = text.toLowerCase();
  let category: RoutingCategory = "standard";
  if (/quick|간단|빠르게/u.test(lower)) {
    category = "quick";
  } else if (/architecture|설계|구조/u.test(lower)) {
    category = "architecture";
  } else if (/visual-high|브랜딩 전략|디자인 시스템/u.test(lower)) {
    category = "visual-high";
  } else if (/visual|ui|ux|디자인/u.test(lower)) {
    category = "visual";
  } else if (/high-risk|법률|보안|리스크/u.test(lower)) {
    category = "high-risk";
  } else if (/critique|비판|반례/u.test(lower)) {
    category = "critique";
  } else if (/research|조사|분석/u.test(lower)) {
    category = "research";
  }

  const worker = ROUTING_RULES[category];
  const role = findRole(worker);
  return {
    category,
    worker,
    tier: role.tier,
    rationale: `default ${category}`,
  };
}

async function ensureInputRef(root: string): Promise<string> {
  const preferred = path.join(root, "README.md");
  try {
    await fs.access(preferred);
    return preferred;
  } catch {
    const fallback = path.join(root, "runtime", "state", "context.md");
    await fs.writeFile(fallback, "# context\n", "utf8");
    return fallback;
  }
}

function buildPacket(
  root: string,
  jobId: string,
  inputRef: string,
  options: {
    outcomeKind: ExecuteMissionOptions["outcomeKind"];
    workspacePath?: string | undefined;
  },
): PacketManifest {
  const artifactDir = runtimePath(root, "artifacts", jobId);
  const outcomeKind = options.outcomeKind ?? "research_brief";
  return {
    required_refs: [inputRef],
    optional_refs: [],
    code_refs: [
      path.join(root, "src", "cli.ts"),
      path.join(root, "role-registry.json"),
    ],
    acceptance_checks: ["summary exists", "closeout docs exist"],
    open_questions: [],
    allowed_write_roots: [
      artifactDir,
      ...(options.workspacePath ? [options.workspacePath] : []),
    ],
    working_dir: options.workspacePath ?? root,
    outcome_kind: outcomeKind,
    canonical_deliverable_name: canonicalDeliverableFileName(outcomeKind),
  };
}

async function writeMissionCloseout(
  root: string,
  mission: Mission,
  request: string,
  routing: RoutingDecision,
  summaryPath: string,
): Promise<{
  missionNotePath: string;
  epicNotePath: string;
  resultSummary: string;
  nextSteps: string[];
}> {
  const artifactDir = missionArtifactDir(root, mission.mission_id);
  await fs.mkdir(artifactDir, { recursive: true });
  const summaryBody = await fs.readFile(summaryPath, "utf8");
  const workerArtifactDir = path.dirname(summaryPath);
  const result: ResultFile = await readResultFile(workerArtifactDir);
  const canonicalDeliverableName = canonicalDeliverableFileName(
    result.outcome_kind,
  );
  const sourceDeliverablePath = path.join(
    workerArtifactDir,
    canonicalDeliverableName,
  );
  const missionArtifactDeliverablePath = path.join(
    artifactDir,
    canonicalDeliverableName,
  );
  const targetDeliverablePath = missionDeliverablePath(
    mission.project_ref,
    mission.epic_ref.slug,
    mission.mission_id,
    canonicalDeliverableName,
  );
  await fs.mkdir(path.dirname(targetDeliverablePath), { recursive: true });
  await fs.copyFile(sourceDeliverablePath, targetDeliverablePath);
  await fs.copyFile(sourceDeliverablePath, missionArtifactDeliverablePath);
  const missionResult: ResultFile = {
    ...result,
    deliverable_refs: [missionArtifactDeliverablePath, targetDeliverablePath],
  };
  await fs.writeFile(
    path.join(artifactDir, "result.json"),
    JSON.stringify(missionResult, null, 2),
    "utf8",
  );
  const resultSummary = result.result_summary;
  const nextSteps =
    result.remaining_work.length > 0
      ? result.remaining_work
      : [
          "해당 epic thread에서 후속 요청이 있으면 다음 mission으로 이어갑니다.",
        ];

  const statusBody = [
    "# 현재 상태",
    "",
    "완료",
    "",
    "# 이번 세션에서 완료한 것",
    "",
    ...result.completed_items.map((item) => `- ${item}`),
    `- 요청 처리: ${request}`,
    `- 담당: ${routing.worker} / ${routing.tier}`,
    `- 결과 요약: ${resultSummary}`,
    "",
  ].join("\n");
  const nextStepsBody = [
    "# 다음 우선순위",
    "",
    ...nextSteps,
    "",
    "# 재개 순서",
    "",
    `- epic thread ${mission.epic_ref.discord_thread_id}에서 후속 요청 확인`,
    "- 필요 시 같은 epic에서 다음 mission 시작",
    "",
  ].join("\n");

  await fs.writeFile(path.join(artifactDir, "STATUS.md"), statusBody, "utf8");
  await fs.writeFile(
    path.join(artifactDir, "NEXT-STEPS.md"),
    nextStepsBody,
    "utf8",
  );
  await fs.writeFile(
    path.join(artifactDir, "closeout.json"),
    JSON.stringify(
      {
        status: "complete",
        obsidian_note_ref: "",
        completed_items: result.completed_items,
        next_steps: nextSteps,
      },
      null,
      2,
    ),
    "utf8",
  );

  const missionNotePath = await writeMissionCanonicalNote(root, mission, {
    summaryBody,
    result,
    completedItems: result.completed_items.map((item) => `- ${item}`),
    nextSteps: nextSteps.map((item) => `- ${item}`),
    risks: result.risks.map((item) => `- ${item}`),
    deliverableName: canonicalDeliverableName,
  });
  const epicNotePath = await writeEpicOverviewNote(root, mission);
  await fs.writeFile(
    path.join(artifactDir, "closeout.json"),
    JSON.stringify(
      {
        status: "complete",
        obsidian_note_ref: missionNotePath,
        completed_items: result.completed_items,
        next_steps: nextSteps,
      },
      null,
      2,
    ),
    "utf8",
  );

  return {
    missionNotePath,
    epicNotePath,
    resultSummary,
    nextSteps,
  };
}

export async function executeMissionFlow(
  root: string,
  options: ExecuteMissionOptions = {},
): Promise<{
  missionId: string;
  ingress: Awaited<ReturnType<typeof ingestIngressEvent>>;
  routing: RoutingDecision;
  job: Awaited<ReturnType<typeof createJob>>;
  workerResult: Awaited<ReturnType<typeof runWorker>>;
  closeout: Awaited<ReturnType<typeof verifyMissionCloseout>>;
  reports: ReportRecord[];
  requestBrief: string;
  missionNotePath: string;
  epicNotePath: string;
  resultSummary: string;
  nextStep: string;
}> {
  const request = String(options.request ?? "").trim();
  const projectRef = options.projectRef ?? (await ensureLocalProjectRef(root));
  const epicRef = options.epicRef ?? {
    epic_id: createStampedId(
      "epic",
      `${projectRef.project_slug}:${options.chatId ?? "cli"}`,
      options.now,
    ),
    project_slug: projectRef.project_slug,
    title: "runtime",
    slug: "runtime",
    discord_thread_id: options.chatId ?? "cli",
    status: "open" as const,
    active_mission_id: null,
    obsidian_note_ref: epicNotePath(projectRef, "runtime"),
    created_at: options.now ?? new Date().toISOString(),
    updated_at: options.now ?? new Date().toISOString(),
  };
  const routing = classifyRequest(request);
  const generatedMessageId = `manual-${String(Date.now())}`;
  const messageId = options.messageId ?? generatedMessageId;
  const ingress = await ingestIngressEvent(root, {
    source: options.source ?? "discord",
    eventType: options.eventType ?? "message_create",
    upstreamEventId: messageId,
    threadRef: { chatId: options.chatId ?? "cli", messageId },
    projectRef,
    epicRef,
    userRequest: request,
    category: routing.category,
    priorityFloor: "P1",
    now: options.now,
  });

  const mission = await readMission(root, ingress.missionId);
  if (!mission) {
    throw new Error(`Mission missing after ingress: ${ingress.missionId}`);
  }
  const requestSummary = createRequestSummary(mission.user_request);
  const requestBrief = createRequestBrief(mission.user_request);
  const outcomeKind =
    options.outcomeKind ?? classifyOutcomeKind(request, routing);
  const reports: ReportRecord[] = [];

  const existingEpic = await readEpic(root, mission.epic_ref.epic_id);
  if (!existingEpic) {
    await writeEpic(root, mission.epic_ref);
  }
  const boundEpic = await bindEpicMission(
    root,
    mission.epic_ref.epic_id,
    mission.mission_id,
    {
      now: options.now,
    },
  );
  mission.epic_ref = boundEpic;
  await writeMission(root, mission);
  await writeMissionCanonicalNote(root, mission);
  await writeEpicOverviewNote(root, mission);

  const pushReport = async (
    reportKey: string,
    reportInput: Omit<
      Parameters<typeof recordReport>[1],
      "missionId" | "reportKey" | "role" | "tier" | "requestBrief"
    >,
  ): Promise<ReportRecord> => {
    const report = await recordReport(root, {
      missionId: mission.mission_id,
      reportKey,
      role: "ceo",
      tier: "standard",
      requestBrief,
      ...reportInput,
    });
    reports.push(report);
    if (options.onReport) {
      await options.onReport(report);
    }
    return report;
  };

  await pushReport(
    "mission.created",
    buildMissionCreatedReport(requestSummary, routing),
  );

  const inputRef = await ensureInputRef(root);
  const job = await createJob(root, {
    missionId: mission.mission_id,
    worker: routing.worker,
    category: routing.category,
    priority: "P1",
    task: request,
    deliverable: "summary.md 작성",
    constraints: ["artifact-only handoff 준수", "필요 시 handoff.json 생성"],
    inputRefs: [inputRef],
    now: options.now,
  });

  await writePacket(
    root,
    job.job_id,
    buildPacket(root, job.job_id, inputRef, {
      outcomeKind,
      workspacePath: options.workspacePath,
    }),
  );
  await pushReport(
    "job.routed",
    buildJobRoutedReport(requestSummary, routing, job.packet_ref),
  );
  let activeJob = job;
  let workerResult: WorkerRunResult;
  let retryReported = false;
  try {
    workerResult = await runWorker(root, activeJob.worker, activeJob.job_id, {
      ...resolveWorkerExecution(options, 0),
      now: options.now,
    });
  } catch (error) {
    if (options.testScenario !== "retry-once") {
      throw error;
    }

    const failedJob = await readJob(root, activeJob.job_id);
    if (!failedJob) {
      throw error;
    }

    const updatedFailedJob = await updateJob(
      root,
      failedJob.job_id,
      async (current) => ({
        ...current,
        retry_count: (current.retry_count ?? 0) + 1,
        report_status: {
          ...current.report_status,
          last_retry_at: options.now ?? new Date().toISOString(),
        },
      }),
      { now: options.now },
    );
    activeJob = await ensureRetryJob(root, updatedFailedJob, {
      now: options.now,
    });
    await pushReport(
      "job.retried",
      buildRetryReviewReport({
        requestSummary,
        retryRequired: true,
        retryReason:
          "1차 실행 결과가 산출물 계약을 충족하지 않아 보완 재실행을 시작합니다.",
        nextAssignee: `${routing.worker} / ${routing.tier}`,
      }),
    );
    retryReported = true;
    workerResult = await runWorker(root, activeJob.worker, activeJob.job_id, {
      ...resolveWorkerExecution(options, 1),
      now: options.now,
    });
  }
  const workerResultFile = await readResultFile(workerResult.artifactDir);

  await pushReport(
    "handoff.completed",
    buildHandoffCompletedReport(requestSummary, workerResultFile),
  );
  if (!retryReported) {
    await pushReport(
      "job.retried",
      buildRetryReviewReport({
        requestSummary,
        retryRequired: false,
      }),
    );
  }

  const closeoutDraft = await writeMissionCloseout(
    root,
    mission,
    request,
    routing,
    workerResult.summaryPath,
  );
  await pushReport(
    "mission.completed",
    buildMissionCompletedReport(requestSummary),
  );

  const closeout = await verifyMissionCloseout(root, mission.mission_id);
  await clearEpicMission(root, mission.epic_ref.epic_id, mission.mission_id, {
    now: options.now,
  });
  const [finalMission, finalEpic] = await Promise.all([
    readMission(root, mission.mission_id),
    readEpic(root, mission.epic_ref.epic_id),
  ]);
  if (finalMission && finalEpic) {
    finalMission.epic_ref = finalEpic;
    await writeMission(root, finalMission);
    const finalResult = await readResultFile(
      path.dirname(workerResult.summaryPath),
    );
    await writeMissionCanonicalNote(root, finalMission, {
      summaryBody: await fs.readFile(workerResult.summaryPath, "utf8"),
      result: finalResult,
      completedItems: finalResult.completed_items.map((item) => `- ${item}`),
      nextSteps: closeoutDraft.nextSteps.map((item) => `- ${item}`),
      risks: finalResult.risks.map((item) => `- ${item}`),
      deliverableName: canonicalDeliverableFileName(outcomeKind),
    });
    await writeEpicOverviewNote(root, finalMission);
  }
  return {
    missionId: mission.mission_id,
    ingress,
    routing,
    job,
    workerResult,
    closeout,
    reports,
    requestBrief,
    missionNotePath: closeoutDraft.missionNotePath,
    epicNotePath: closeoutDraft.epicNotePath,
    resultSummary: closeoutDraft.resultSummary,
    nextStep: closeoutDraft.nextSteps[0] ?? "",
  };
}

export function parseGodCommand(input: string): GodCommand | null {
  const normalized = input.trim().toLowerCase();
  if (normalized === "status") {
    return { command: "status", args: [] };
  }
  if (normalized === "doctor") {
    return { command: "doctor", args: [] };
  }
  if (normalized === "supervisor lease") {
    return { command: "supervisor", args: ["lease"] };
  }
  if (normalized === "supervisor tick") {
    return { command: "supervisor", args: ["tick"] };
  }
  if (normalized === "supervisor daemon") {
    return { command: "supervisor", args: ["daemon"] };
  }
  return null;
}
