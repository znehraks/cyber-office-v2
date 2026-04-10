import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { appendEvent } from "./events.js";
import { parseClaudeStreamOutput } from "./claude-output.js";
import { assertPacketRefs, readJob, readPacket, transitionJobStatus, updateJob } from "./jobs.js";
import { findRole } from "./roles.js";
import { exists, nowIso, runtimePath } from "./runtime.js";

function roleDir(root, role) {
  return runtimePath(root, "workers", role);
}

async function readRoleAssets(root, role) {
  const dir = roleDir(root, role);
  const promptPath = path.join(dir, "prompt.txt");
  const settingsPath = path.join(dir, "settings.json");
  const mcpPath = path.join(dir, "mcp.json");

  const [prompt, settings] = await Promise.all([
    fs.readFile(promptPath, "utf8"),
    fs.readFile(settingsPath, "utf8"),
  ]);

  return {
    dir,
    promptText: prompt,
    settings: JSON.parse(settings),
    mcpPath,
  };
}

function buildUserPrompt(job, packet, artifactDir) {
  const lines = [
    `Task: ${job.input.task}`,
    `Deliverable: ${job.input.deliverable}`,
    "Constraints:",
    ...(job.input.constraints ?? []).map((line) => `- ${line}`),
    "Input refs:",
    ...(packet.required_refs ?? []).map((line) => `- ${line}`),
    ...(packet.optional_refs ?? []).map((line) => `- ${line}`),
    "Code refs:",
    ...(packet.code_refs ?? []).map((line) => `- ${line}`),
    `Artifact dir: ${artifactDir}`,
    `Packet path: ${job.packet_ref}`,
    "Hard requirement: write summary.md into Artifact dir before exiting.",
  ];
  return lines.join("\n");
}

function buildClaudeArgs(root, job, roleAssets, packet, artifactDir, options) {
  const args = [
    ...(options.extraArgs ?? []),
    "-p",
    buildUserPrompt(job, packet, artifactDir),
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
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

  const addDirs = [...new Set([packet.working_dir, ...(packet.allowed_write_roots ?? []), root].filter(Boolean))];
  if (addDirs.length > 0) {
    args.push("--add-dir", ...addDirs);
  }
  if ((roleAssets.settings.allowed_tools ?? []).length > 0) {
    args.push("--allowed-tools", roleAssets.settings.allowed_tools.join(","));
  }
  return args;
}

async function runProcess(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    let stdout = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      options.onStdout?.(chunk.toString());
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

export async function runWorker(root, roleName, jobId, options = {}) {
  const job = await readJob(root, jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }
  findRole(roleName);

  const packet = await assertPacketRefs(root, jobId);
  const roleAssets = await readRoleAssets(root, roleName);
  const artifactDir = runtimePath(root, "artifacts", jobId);
  await fs.mkdir(artifactDir, { recursive: true });

  await transitionJobStatus(root, jobId, ["queued", "stalled"], "running", {}, { now: options.now });
  await appendEvent(
    root,
    "worker.started",
    { mission_id: job.mission_id, job_id: job.job_id, worker: job.worker, tier: job.tier },
    { now: options.now },
  );

  const command = options.claudeBin ?? process.env.CLAUDE_BIN ?? "claude";
  const args = buildClaudeArgs(root, job, roleAssets, packet, artifactDir, options);
  const now = () => nowIso(options.now);

  const result = await runProcess(command, args, {
    cwd: packet.working_dir ?? root,
    env: {
      ...process.env,
      CO_ROLE: roleName,
      CO_JOB_ID: jobId,
      CO_PACKET_PATH: job.packet_ref,
      CO_ARTIFACT_DIR: artifactDir,
      CO_WORKING_DIR: packet.working_dir ?? root,
      ...(options.env ?? {}),
    },
    onStdout: async () => {
      await updateJob(
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

  const summaryPath = path.join(artifactDir, "summary.md");
  const parsedOutput = parseClaudeStreamOutput(result.stdout);
  let hasSummary = await exists(summaryPath);

  if (!hasSummary && result.code === 0 && parsedOutput.summaryText && !parsedOutput.errorText) {
    await fs.writeFile(summaryPath, `${parsedOutput.summaryText}\n`, "utf8");
    hasSummary = true;
  }

  const failureMessage = [
    result.stderr.trim(),
    parsedOutput.errorText,
    result.code !== 0 ? `Worker exited with code ${result.code}` : "",
    !hasSummary ? `Worker completed without summary.md: ${summaryPath}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  if (result.code !== 0 || !hasSummary || parsedOutput.errorText) {
    await transitionJobStatus(
      root,
      jobId,
      ["running"],
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
    throw new Error(failureMessage || "worker failed");
  }

  await updateJob(
    root,
    jobId,
    async (current) => ({
      ...current,
      artifacts: [...new Set([...(current.artifacts ?? []), summaryPath])],
    }),
    { now: options.now },
  );
  await transitionJobStatus(root, jobId, ["running"], "completed", {}, { now: options.now });
  await appendEvent(
    root,
    "worker.completed",
    {
      mission_id: job.mission_id,
      job_id: job.job_id,
      worker: job.worker,
      artifacts: [summaryPath],
    },
    { now: options.now },
  );

  return {
    status: "completed",
    jobId,
    artifactDir,
    summaryPath,
  };
}
