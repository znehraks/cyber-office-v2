#!/usr/bin/env node
import * as fs from "node:fs/promises";
import * as process from "node:process";

import { bootstrapRuntimeWorkers } from "./lib/bootstrap.js";
import { verifyMissionCloseout } from "./lib/closeout.js";
import { runDoctor } from "./lib/doctor.js";
import { loadRuntimeEnv } from "./lib/env.js";
import { ingestIngressEvent } from "./lib/ingress.js";
import { createJob, writePacket } from "./lib/jobs.js";
import { createMission, writeMission } from "./lib/missions.js";
import { executeMissionFlow } from "./lib/orchestrator.js";
import { recordReport } from "./lib/reporting.js";
import { resolveRepoRoot } from "./lib/root.js";
import { ensureRuntimeLayout, readJson, runtimePath } from "./lib/runtime.js";
import {
  attachSession,
  readSessionStatus,
  startSession,
  stopSession,
} from "./lib/session-manager.js";
import { runSmokeScenario } from "./lib/smoke.js";
import { acquireSupervisorLease, supervisorTick } from "./lib/supervisor.js";
import { expectArray, expectString } from "./lib/validation.js";
import { runWorker } from "./lib/worker-runner.js";
import {
  parseMission,
  parsePacketManifest,
  parseSupervisorLease,
} from "./types/domain.js";

const cwd = resolveRepoRoot(import.meta.url);

function usage(): void {
  console.log(`co - cyber-office v2

Usage:
  co init
  co doctor
  co start
  co stop
  co ps
  co attach
  co status [mission_id]
  co ingest discord-message <message_id> <request>
  co create-job <mission_id> <worker> <category> <priority> <task> <deliverable>
  co write-packet <job_id> <packet_json_path>
  co run-worker <role> <job_id>
  co supervisor lease <owner_pid>
  co supervisor tick <owner_pid>
  co supervisor daemon <owner_pid>
  co smoke
  co dispatch <message_id> <request>
  co closeout verify <mission_id>
  co report <mission_id> <report_key> <stage> <role> <tier> <completed> <findings> <next>
`);
}

function parseExtraArgs(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const parsed: unknown = JSON.parse(value);
  return expectArray(parsed, "extra_args").map((item, index) =>
    expectString(item, `extra_args[${String(index)}]`),
  );
}

async function printStatus(root: string, missionId?: string): Promise<void> {
  if (missionId) {
    const mission = await readJson(
      runtimePath(root, "missions", `${missionId}.json`),
      parseMission,
    );
    console.log(JSON.stringify(mission, null, 2));
    return;
  }

  const missions = (
    await fs.readdir(runtimePath(root, "missions")).catch(() => [] as string[])
  ).filter((file) => file.endsWith(".json"));
  const jobs = (
    await fs.readdir(runtimePath(root, "jobs")).catch(() => [] as string[])
  ).filter((file) => file.endsWith(".json"));
  const supervisor = await readJson(
    runtimePath(root, "state", "supervisor.json"),
    parseSupervisorLease,
    null,
  );
  console.log(
    JSON.stringify(
      {
        missions: missions.length,
        jobs: jobs.length,
        supervisor,
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;
  if (!command || command === "-h" || command === "--help") {
    usage();
    return;
  }

  await loadRuntimeEnv();
  await ensureRuntimeLayout(cwd);

  if (command === "init") {
    await bootstrapRuntimeWorkers(cwd);
    console.log(JSON.stringify({ ok: true, root: cwd }, null, 2));
    return;
  }

  if (command === "doctor") {
    const result = await runDoctor(cwd);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "start") {
    const result = await startSession(cwd);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "stop") {
    const result = await stopSession(cwd);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "ps") {
    const result = await readSessionStatus(cwd);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "attach") {
    await attachSession(cwd);
    return;
  }

  if (command === "status") {
    await printStatus(cwd, args[0]);
    return;
  }

  if (command === "ingest" && args[0] === "discord-message") {
    const [, messageId = "", ...requestParts] = args;
    const request = requestParts.join(" ").trim();
    const result = await ingestIngressEvent(cwd, {
      source: "discord",
      eventType: "message_create",
      upstreamEventId: messageId,
      threadRef: { chatId: "cli", messageId },
      userRequest: request,
      category: "standard",
      priorityFloor: "P1",
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "create-mission") {
    const [
      missionId = "",
      category = "standard",
      priorityFloor = "P1",
      ...requestParts
    ] = args;
    const mission = createMission({
      missionId,
      ingressKey: `manual:${missionId}`,
      userRequest: requestParts.join(" "),
      category,
      priorityFloor:
        priorityFloor === "P0" ||
        priorityFloor === "P1" ||
        priorityFloor === "P2" ||
        priorityFloor === "P3"
          ? priorityFloor
          : "P1",
    });
    await writeMission(cwd, mission);
    console.log(JSON.stringify(mission, null, 2));
    return;
  }

  if (command === "create-job") {
    const [
      missionId = "",
      worker = "",
      category = "standard",
      priorityArg = "P1",
      task = "",
      deliverable = "",
    ] = args;
    const priority =
      priorityArg === "P0" ||
      priorityArg === "P1" ||
      priorityArg === "P2" ||
      priorityArg === "P3"
        ? priorityArg
        : "P1";
    const job = await createJob(cwd, {
      missionId,
      worker,
      category,
      priority,
      task,
      deliverable,
    });
    console.log(JSON.stringify(job, null, 2));
    return;
  }

  if (command === "write-packet") {
    const [jobId = "", packetPath = ""] = args;
    const packetRaw = await fs.readFile(packetPath, "utf8");
    const packetValue: unknown = JSON.parse(packetRaw);
    const result = await writePacket(
      cwd,
      jobId,
      parsePacketManifest(packetValue),
    );
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "run-worker") {
    const [role = "", jobId = ""] = args;
    const result = await runWorker(cwd, role, jobId);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "supervisor" && args[0] === "lease") {
    const result = await acquireSupervisorLease(cwd, {
      ownerPid: args[1] ?? String(process.pid),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "supervisor" && args[0] === "tick") {
    const result = await supervisorTick(cwd, {
      ownerPid: args[1] ?? String(process.pid),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "supervisor" && args[0] === "daemon") {
    const ownerPid = args[1] ?? String(process.pid);
    const intervalMs = Number(
      process.env["CO_SUPERVISOR_INTERVAL_MS"] ?? 30_000,
    );
    await acquireSupervisorLease(cwd, { ownerPid });
    console.log(JSON.stringify({ ok: true, ownerPid, intervalMs }, null, 2));
    setInterval(() => {
      void supervisorTick(cwd, { ownerPid })
        .then((result) => {
          if (
            result.retried.length > 0 ||
            result.failed.length > 0 ||
            result.recoveredIngresses.length > 0
          ) {
            console.log(JSON.stringify(result));
          }
        })
        .catch((error: unknown) => {
          const message =
            error instanceof Error
              ? (error.stack ?? error.message)
              : String(error);
          console.error(message);
        });
    }, intervalMs);
    return;
  }

  if (command === "smoke") {
    const result = await runSmokeScenario(cwd, {
      claudeBin: process.env["CLAUDE_BIN"],
      extraArgs: parseExtraArgs(process.env["CO_SMOKE_EXTRA_ARGS_JSON"]),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "dispatch") {
    const [messageId = "", ...requestParts] = args;
    const result = await executeMissionFlow(cwd, {
      source: "discord",
      messageId,
      chatId: "cli",
      request: requestParts.join(" ").trim(),
      claudeBin: process.env["CLAUDE_BIN"],
      extraArgs: parseExtraArgs(process.env["CO_SMOKE_EXTRA_ARGS_JSON"]),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "closeout" && args[0] === "verify") {
    const result = await verifyMissionCloseout(cwd, args[1] ?? "");
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "report") {
    const [
      missionId = "",
      reportKey = "",
      stage = "",
      role = "",
      tier = "",
      completed = "",
      findings = "",
      next = "",
    ] = args;
    const result = await recordReport(cwd, {
      missionId,
      reportKey,
      stage,
      role,
      tier,
      requestSummary:
        completed === ""
          ? "수동 보고로 현재 진행 상황을 정리합니다."
          : `${completed} 진행 상황을 정리한 수동 보고입니다.`,
      snapshot:
        findings === ""
          ? `${stage} 단계 보고입니다. 다음 조치로 이어집니다.`
          : `${stage} 단계 보고입니다. ${findings}`,
      completed,
      transitionReason:
        findings === ""
          ? "수동 보고 기준으로 다음 조치를 이어갑니다."
          : findings,
      next,
      evidence: null,
      findings,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  usage();
  globalThis.process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(message);
  globalThis.process.exitCode = 1;
});
