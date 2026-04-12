import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { Job, PacketManifest, WorkerRunResult } from "../types/domain.js";
import { parseClaudeStreamOutput } from "./claude-output.js";
import { appendEvent } from "./events.js";
import {
  assertPacketRefs,
  readJob,
  transitionJobStatus,
  updateJob,
} from "./jobs.js";
import {
  assertResultArtifacts,
  canonicalDeliverableFileName,
} from "./results.js";
import { findRole } from "./roles.js";
import { exists, nowIso, runtimePath } from "./runtime.js";
import {
  expectRecord,
  readOptionalStringArray,
  readString,
} from "./validation.js";

interface RoleAssetSettings {
  model: string;
  effort: string;
  allowed_tools: string[];
}

interface RoleAssets {
  dir: string;
  promptText: string;
  settings: RoleAssetSettings;
  mcpPath: string;
}

interface RunWorkerOptions {
  claudeBin?: string | undefined;
  extraArgs?: string[] | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  now?: string | undefined;
}

interface ProcessOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  onStdout?: (chunk: string) => void;
}

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function buildResultJsonTemplate(
  outcomeKind: PacketManifest["outcome_kind"],
  artifactDir: string,
  canonicalDeliverableName: string,
  workingDir: string,
): string {
  const canonicalRef = path.join(artifactDir, canonicalDeliverableName);
  switch (outcomeKind) {
    case "plan_package":
      return JSON.stringify(
        {
          outcome_kind: "plan_package",
          result_summary:
            "이번 요청에서 정리한 계획 패키지와 핵심 결정을 한 문장으로 요약한다.",
          completed_items: ["완료 항목 1", "완료 항목 2"],
          remaining_work: ["남은 일 1"],
          risks: ["리스크 1"],
          deliverable_refs: [canonicalRef],
          documents_created: [canonicalDeliverableName],
          decisions_made: ["결정 1"],
          open_questions: [],
          follow_up_tasks: ["후속 작업 1"],
        },
        null,
        2,
      );
    case "design_package":
      return JSON.stringify(
        {
          outcome_kind: "design_package",
          result_summary:
            "이번 요청에서 만든 디자인 결과와 핵심 판단을 한 문장으로 요약한다.",
          completed_items: ["완료 항목 1", "완료 항목 2"],
          remaining_work: ["남은 일 1"],
          risks: ["리스크 1"],
          deliverable_refs: [canonicalRef],
          design_decisions: ["디자인 결정 1"],
          open_questions: [],
          follow_up_tasks: ["후속 작업 1"],
        },
        null,
        2,
      );
    case "code_change":
      return JSON.stringify(
        {
          outcome_kind: "code_change",
          result_summary:
            "이번 요청에서 실제로 구현하거나 수정한 내용을 한 문장으로 요약한다.",
          completed_items: ["완료 항목 1", "완료 항목 2"],
          remaining_work: ["남은 일 1"],
          risks: ["리스크 1"],
          deliverable_refs: [canonicalRef],
          workspace_ref: workingDir,
          changed_paths: ["src/App.tsx", "package.json"],
          verification: ["npm test", "수동 확인 1"],
          follow_up_tasks: ["후속 작업 1"],
        },
        null,
        2,
      );
    default:
      return JSON.stringify(
        {
          outcome_kind: "research_brief",
          result_summary:
            "이번 요청에서 확인한 핵심 결론을 한 문장으로 요약한다.",
          completed_items: ["완료 항목 1", "완료 항목 2"],
          remaining_work: ["남은 일 1"],
          risks: ["리스크 1"],
          deliverable_refs: [canonicalRef],
          key_findings: ["핵심 발견 1", "핵심 발견 2", "핵심 발견 3"],
          recommended_next_steps: ["다음 단계 1"],
          follow_up_tasks: ["후속 작업 1"],
        },
        null,
        2,
      );
  }
}

function buildArtifactContract(
  packet: PacketManifest,
  artifactDir: string,
  canonicalDeliverableName: string,
): string[] {
  const outcomeKind = packet.outcome_kind ?? "research_brief";
  const canonicalRef = path.join(artifactDir, canonicalDeliverableName);
  return [
    "Artifact contract:",
    `- 반드시 ${path.join(artifactDir, "summary.md")} 파일을 쓴다.`,
    `- 반드시 ${canonicalRef} 파일을 쓴다.`,
    `- 반드시 ${path.join(artifactDir, "result.json")} 파일을 쓴다.`,
    "- result.json은 아래 스키마를 정확히 따른다.",
    "- result_summary는 사람이 읽는 한 문장 요약이어야 한다. job:, mission:, worker:, status: 같은 접두는 금지다.",
    "- deliverable_refs에는 canonical deliverable의 절대 경로를 반드시 포함한다.",
    "- completed_items는 최소 1개 이상 작성한다.",
    outcomeKind === "code_change"
      ? `- code_change에서는 workspace_ref=${packet.working_dir}, changed_paths, verification을 반드시 채운다.`
      : "- outcome_kind별 필수 배열 항목을 모두 채운다.",
    "result.json template:",
    buildResultJsonTemplate(
      outcomeKind,
      artifactDir,
      canonicalDeliverableName,
      packet.working_dir,
    ),
  ];
}

function parseRoleAssetSettings(value: unknown): RoleAssetSettings {
  const record = expectRecord(value, "worker.settings");
  return {
    model: readString(record, "model", "worker.settings"),
    effort: readString(record, "effort", "worker.settings"),
    allowed_tools: readOptionalStringArray(
      record,
      "allowed_tools",
      "worker.settings",
    ),
  };
}

function roleDir(root: string, role: string): string {
  return runtimePath(root, "workers", role);
}

async function readRoleAssets(root: string, role: string): Promise<RoleAssets> {
  const dir = roleDir(root, role);
  const promptPath = path.join(dir, "prompt.txt");
  const settingsPath = path.join(dir, "settings.json");
  const mcpPath = path.join(dir, "mcp.json");

  const [prompt, settingsRaw] = await Promise.all([
    fs.readFile(promptPath, "utf8"),
    fs.readFile(settingsPath, "utf8"),
  ]);
  const settingsValue: unknown = JSON.parse(settingsRaw);

  return {
    dir,
    promptText: prompt,
    settings: parseRoleAssetSettings(settingsValue),
    mcpPath,
  };
}

function buildUserPrompt(
  job: Job,
  packet: PacketManifest,
  artifactDir: string,
  canonicalDeliverableName: string,
): string {
  const lines = [
    `Task: ${job.input.task}`,
    `Deliverable: ${job.input.deliverable}`,
    "Constraints:",
    ...job.input.constraints.map((line) => `- ${line}`),
    "Input refs:",
    ...packet.required_refs.map((line) => `- ${line}`),
    ...packet.optional_refs.map((line) => `- ${line}`),
    "Code refs:",
    ...packet.code_refs.map((line) => `- ${line}`),
    `Artifact dir: ${artifactDir}`,
    `Packet path: ${job.packet_ref}`,
    ...buildArtifactContract(packet, artifactDir, canonicalDeliverableName),
    "Hard requirement: 모든 필수 산출물을 쓴 뒤 프로세스를 종료한다.",
  ];
  return lines.join("\n");
}

function buildClaudeArgs(
  root: string,
  job: Job,
  roleAssets: RoleAssets,
  packet: PacketManifest,
  artifactDir: string,
  options: RunWorkerOptions,
): string[] {
  const canonicalDeliverableName =
    packet.canonical_deliverable_name ??
    canonicalDeliverableFileName(packet.outcome_kind ?? "research_brief");
  const args = [
    ...(options.extraArgs ?? []),
    "-p",
    buildUserPrompt(job, packet, artifactDir, canonicalDeliverableName),
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--permission-mode",
    "acceptEdits",
    "--strict-mcp-config",
    "--model",
    roleAssets.settings.model,
    "--effort",
    roleAssets.settings.effort,
    "--mcp-config",
    roleAssets.mcpPath,
    "--append-system-prompt",
    roleAssets.promptText.trim(),
  ];

  const addDirs = [
    ...new Set(
      [packet.working_dir, ...packet.allowed_write_roots, root].filter(
        (entry) => entry !== "",
      ),
    ),
  ];
  if (addDirs.length > 0) {
    args.push("--add-dir", ...addDirs);
  }
  if (roleAssets.settings.allowed_tools.length > 0) {
    args.push("--allowed-tools", roleAssets.settings.allowed_tools.join(","));
  }
  return args;
}

function runProcess(
  command: string,
  args: string[],
  options: ProcessOptions,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    let stdout = "";

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      options.onStdout?.(text);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

export async function runWorker(
  root: string,
  roleName: string,
  jobId: string,
  options: RunWorkerOptions = {},
): Promise<WorkerRunResult> {
  const job = await readJob(root, jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }
  findRole(roleName);

  const packet = await assertPacketRefs(root, jobId);
  const roleAssets = await readRoleAssets(root, roleName);
  const artifactDir = runtimePath(root, "artifacts", jobId);
  await fs.mkdir(artifactDir, { recursive: true });

  await transitionJobStatus(
    root,
    jobId,
    ["queued", "stalled"],
    "running",
    {},
    { now: options.now },
  );
  await appendEvent(
    root,
    "worker.started",
    {
      mission_id: job.mission_id,
      job_id: job.job_id,
      worker: job.worker,
      tier: job.tier,
    },
    { now: options.now },
  );

  const command = options.claudeBin ?? process.env["CLAUDE_BIN"] ?? "claude";
  const args = buildClaudeArgs(
    root,
    job,
    roleAssets,
    packet,
    artifactDir,
    options,
  );
  const now = (): string => nowIso(options.now);

  const outcomeKind = packet.outcome_kind ?? "research_brief";
  const canonicalDeliverableName =
    packet.canonical_deliverable_name ??
    canonicalDeliverableFileName(outcomeKind);
  const summaryPath = path.join(artifactDir, "summary.md");

  try {
    const result = await runProcess(command, args, {
      cwd: packet.working_dir,
      env: {
        ...process.env,
        CO_ROLE: roleName,
        CO_JOB_ID: jobId,
        CO_PACKET_PATH: job.packet_ref,
        CO_ARTIFACT_DIR: artifactDir,
        CO_WORKING_DIR: packet.working_dir,
        CO_OUTCOME_KIND: outcomeKind,
        CO_CANONICAL_DELIVERABLE: canonicalDeliverableName,
        CO_WORKSPACE_DIR: packet.working_dir,
        ...(options.env ?? {}),
      },
      onStdout: () => {
        void updateJob(
          root,
          jobId,
          async (current) => ({
            ...current,
            heartbeat_at: now(),
            progress_at: now(),
          }),
          { now: options.now },
        );
      },
    });

    const parsedOutput = parseClaudeStreamOutput(result.stdout);
    const hasSummary = await exists(summaryPath);
    const failureMessage = [
      result.stderr.trim(),
      parsedOutput.errorText,
      result.code !== 0 ? `Worker exited with code ${String(result.code)}` : "",
      !hasSummary ? `Worker completed without summary.md: ${summaryPath}` : "",
    ]
      .filter((entry) => entry !== "")
      .join("\n");

    if (result.code !== 0 || !hasSummary || parsedOutput.errorText !== "") {
      throw new Error(failureMessage || "worker failed");
    }

    const validatedResult = await assertResultArtifacts({
      artifactDir,
      outcomeKind,
      canonicalDeliverableName,
    });
    const artifactPaths = [
      summaryPath,
      path.join(artifactDir, canonicalDeliverableName),
      path.join(artifactDir, "result.json"),
      ...validatedResult.deliverable_refs,
    ];
    await updateJob(
      root,
      jobId,
      async (current) => ({
        ...current,
        artifacts: [...new Set([...current.artifacts, ...artifactPaths])],
      }),
      { now: options.now },
    );
    await transitionJobStatus(
      root,
      jobId,
      ["running"],
      "completed",
      {},
      { now: options.now },
    );
    await appendEvent(
      root,
      "worker.completed",
      {
        mission_id: job.mission_id,
        job_id: job.job_id,
        worker: job.worker,
        artifacts: [
          ...new Set([summaryPath, ...validatedResult.deliverable_refs]),
        ],
      },
      { now: options.now },
    );

    return {
      status: "completed",
      jobId,
      artifactDir,
      summaryPath,
    };
  } catch (error) {
    const failureMessage =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    await transitionJobStatus(
      root,
      jobId,
      ["running", "queued", "stalled"],
      "failed",
      { error: failureMessage || "worker failed" },
      { now: options.now },
    );
    await appendEvent(
      root,
      "worker.failed",
      {
        mission_id: job.mission_id,
        job_id: job.job_id,
        worker: job.worker,
        stderr: failureMessage,
      },
      { now: options.now },
    );
    throw error instanceof Error ? error : new Error(failureMessage);
  }
}
