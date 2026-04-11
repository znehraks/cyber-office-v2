import * as fs from "node:fs/promises";
import * as path from "node:path";

import type {
  ExecuteMissionOptions,
  GodCommand,
  PacketManifest,
  ReportRecord,
  RoutingCategory,
  RoutingDecision,
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
import { ingestIngressEvent } from "./ingress.js";
import { createJob, writePacket } from "./jobs.js";
import { readMission } from "./missions.js";
import { recordReport } from "./reporting.js";
import { ROUTING_RULES, findRole } from "./roles.js";
import { runtimePath } from "./runtime.js";
import { bindThreadMission, clearThreadMission } from "./thread-missions.js";
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
): PacketManifest {
  return {
    required_refs: [inputRef],
    optional_refs: [],
    code_refs: [
      path.join(root, "src", "cli.ts"),
      path.join(root, "role-registry.json"),
    ],
    acceptance_checks: ["summary exists", "closeout docs exist"],
    open_questions: [],
    allowed_write_roots: [runtimePath(root, "artifacts", jobId)],
    working_dir: root,
  };
}

async function writeMissionCloseout(
  root: string,
  missionId: string,
  request: string,
  routing: RoutingDecision,
  summaryPath: string,
): Promise<void> {
  const artifactDir = runtimePath(root, "artifacts", missionId);
  await fs.mkdir(artifactDir, { recursive: true });

  const statusBody = [
    "# 현재 상태",
    "",
    "완료",
    "",
    "# 이번 세션에서 완료한 것",
    "",
    `- 요청 처리: ${request}`,
    `- 라우팅: ${routing.worker} / ${routing.tier}`,
    `- 산출물: ${summaryPath}`,
    "",
  ].join("\n");
  const nextStepsBody = [
    "# 다음 우선순위",
    "",
    "- Discord ingress wiring 운영 연결",
    "",
    "# 재개 순서",
    "",
    "- supervisor daemon 상시 실행",
    "- ceo bot 실제 token으로 smoke",
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
        obsidian_note_ref: path.join(root, "README.md"),
        completed_items: [request, `${routing.worker} / ${routing.tier}`],
        next_steps: ["Discord ceo wiring", "supervisor daemonize"],
      },
      null,
      2,
    ),
    "utf8",
  );
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
}> {
  const request = String(options.request ?? "").trim();
  const routing = classifyRequest(request);
  const generatedMessageId = `manual-${String(Date.now())}`;
  const messageId = options.messageId ?? generatedMessageId;
  const ingress = await ingestIngressEvent(root, {
    source: options.source ?? "discord",
    eventType: options.eventType ?? "message_create",
    upstreamEventId: messageId,
    threadRef: { chatId: options.chatId ?? "cli", messageId },
    userRequest: request,
    category: routing.category,
    priorityFloor: "P1",
    now: options.now,
  });

  const mission = await readMission(root, ingress.missionId);
  if (!mission) {
    throw new Error(`Mission missing after ingress: ${ingress.missionId}`);
  }
  const chatId = mission.thread_ref?.chatId ?? options.chatId ?? null;
  const requestSummary = createRequestSummary(mission.user_request);
  const requestBrief = createRequestBrief(mission.user_request);
  const reports: ReportRecord[] = [];

  if (chatId) {
    await bindThreadMission(root, chatId, mission.mission_id, {
      now: options.now,
    });
  }

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

  await writePacket(root, job.job_id, buildPacket(root, job.job_id, inputRef));
  await pushReport(
    "job.routed",
    buildJobRoutedReport(requestSummary, routing, job.packet_ref),
  );
  const workerResult = await runWorker(root, job.worker, job.job_id, {
    claudeBin: options.claudeBin,
    extraArgs: options.extraArgs,
    now: options.now,
  });

  await pushReport(
    "handoff.completed",
    buildHandoffCompletedReport(requestSummary, workerResult.summaryPath),
  );
  await pushReport(
    "job.retried",
    buildRetryReviewReport({
      requestSummary,
      retryRequired: false,
    }),
  );

  await writeMissionCloseout(
    root,
    mission.mission_id,
    request,
    routing,
    workerResult.summaryPath,
  );
  await pushReport(
    "mission.completed",
    buildMissionCompletedReport(requestSummary),
  );

  const closeout = await verifyMissionCloseout(root, mission.mission_id);
  if (chatId) {
    await clearThreadMission(root, chatId, mission.mission_id);
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
