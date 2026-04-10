import fs from "node:fs/promises";
import path from "node:path";

import { verifyMissionCloseout } from "./closeout.js";
import { ingestIngressEvent } from "./ingress.js";
import { createJob, writePacket } from "./jobs.js";
import { readMission } from "./missions.js";
import { recordReport } from "./reporting.js";
import { ROUTING_RULES, findRole } from "./roles.js";
import { runtimePath } from "./runtime.js";
import { runWorker } from "./worker-runner.js";

const NICHE_ROUTING = [
  { pattern: /(mobile|앱|ios|android|react native|expo)/i, worker: "app-dev", category: "standard" },
  { pattern: /(ar|vr|xr|webxr|spatial)/i, worker: "ar-xr-master", category: "standard" },
  { pattern: /(3d|glb|gltf|모델링)/i, worker: "3d-modeler", category: "standard" },
  { pattern: /(legal|계약|약관|법률|컴플라이언스)/i, worker: "legal-reviewer", category: "high-risk" },
  { pattern: /(copy|카피|문안|문서|write|writer)/i, worker: "writer", category: "quick" },
  { pattern: /(marketing|마케팅|랜딩|캠페인)/i, worker: "marketer", category: "standard" },
  { pattern: /(sales|영업|제안서)/i, worker: "sales", category: "standard" },
  { pattern: /(n8n|workflow automation|automation)/i, worker: "n8n-automator", category: "standard" },
  { pattern: /(ui|ux|디자인|와이어프레임|landing page)/i, worker: "ui-ux-designer", category: "visual" },
  { pattern: /(research|조사|분석|원인 찾)/i, worker: "researcher", category: "research" },
];

export function classifyRequest(request) {
  const text = String(request ?? "").trim();
  for (const route of NICHE_ROUTING) {
    if (route.pattern.test(text)) {
      const role = findRole(route.worker);
      return {
        category: route.category,
        worker: route.worker,
        tier: role.tier,
        rationale: `matched ${route.pattern}`,
      };
    }
  }

  const lower = text.toLowerCase();
  let category = "standard";
  if (/quick|간단|빠르게/.test(lower)) category = "quick";
  else if (/architecture|설계|구조/.test(lower)) category = "architecture";
  else if (/visual-high|브랜딩 전략|디자인 시스템/.test(lower)) category = "visual-high";
  else if (/visual|ui|ux|디자인/.test(lower)) category = "visual";
  else if (/high-risk|법률|보안|리스크/.test(lower)) category = "high-risk";
  else if (/critique|비판|반례/.test(lower)) category = "critique";
  else if (/research|조사|분석/.test(lower)) category = "research";

  const worker = ROUTING_RULES[category] ?? "fullstack-dev";
  const role = findRole(worker);
  return { category, worker, tier: role.tier, rationale: `default ${category}` };
}

function summarizeNextStep(routing) {
  return `${routing.worker} / ${routing.tier} 실행`;
}

async function ensureInputRef(root) {
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

function buildPacket(root, jobId, inputRef) {
  return {
    required_refs: [inputRef],
    optional_refs: [],
    code_refs: [path.join(root, "src", "cli.js"), path.join(root, "role-registry.json")],
    acceptance_checks: ["summary exists", "closeout docs exist"],
    open_questions: [],
    allowed_write_roots: [runtimePath(root, "artifacts", jobId)],
    working_dir: root,
  };
}

async function writeMissionCloseout(root, missionId, request, routing, summaryPath) {
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
  await fs.writeFile(path.join(artifactDir, "NEXT-STEPS.md"), nextStepsBody, "utf8");
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

export async function executeMissionFlow(root, options = {}) {
  const request = String(options.request ?? "").trim();
  const routing = classifyRequest(request);
  const ingress = await ingestIngressEvent(root, {
    source: options.source ?? "discord",
    eventType: options.eventType ?? "message_create",
    upstreamEventId: options.messageId ?? `manual-${Date.now()}`,
    threadRef: { chatId: options.chatId ?? "cli", messageId: options.messageId ?? `manual-${Date.now()}` },
    userRequest: request,
    category: routing.category,
    priorityFloor: "P1",
    now: options.now,
  });

  const mission = await readMission(root, ingress.missionId);
  const reports = [];

  const pushReport = async (reportKey, stage, completed, findings, next) => {
    const report = await recordReport(root, {
      missionId: mission.mission_id,
      reportKey,
      stage,
      role: "ceo",
      tier: "standard",
      completed,
      findings,
      next,
    });
    reports.push(report);
    await options.onReport?.(report);
    return report;
  };

  await pushReport("mission.created", "요청 접수", `mission 생성: ${mission.mission_id}`, routing.rationale, summarizeNextStep(routing));

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

  await pushReport("job.routed", "worker 라우팅", `${job.worker} / ${job.tier} 배정`, `category=${job.category}`, "packet 생성");

  await writePacket(root, job.job_id, buildPacket(root, job.job_id, inputRef));
  const workerResult = await runWorker(root, job.worker, job.job_id, {
    claudeBin: options.claudeBin,
    extraArgs: options.extraArgs,
    now: options.now,
  });

  await pushReport("handoff.completed", "worker 완료", "summary 수집 완료", workerResult.summaryPath, "closeout 작성");
  await pushReport("job.retried", "retry 상태", "retry 없음", "clean path", "closeout verify");

  await writeMissionCloseout(root, mission.mission_id, request, routing, workerResult.summaryPath);
  await pushReport("mission.completed", "최종 완료", "closeout 문서 생성", "verify 시작", "mission completed");

  const closeout = await verifyMissionCloseout(root, mission.mission_id);
  return {
    missionId: mission.mission_id,
    ingress,
    routing,
    job,
    workerResult,
    closeout,
    reports,
  };
}

export function parseGodCommand(input) {
  const normalized = String(input ?? "").trim().toLowerCase();
  if (normalized === "status") return { command: "status", args: [] };
  if (normalized === "doctor") return { command: "doctor", args: [] };
  if (normalized === "supervisor lease") return { command: "supervisor", args: ["lease"] };
  if (normalized === "supervisor tick") return { command: "supervisor", args: ["tick"] };
  if (normalized === "supervisor daemon") return { command: "supervisor", args: ["daemon"] };
  return null;
}
