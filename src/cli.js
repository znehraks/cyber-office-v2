#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { bootstrapRuntimeWorkers } from "./lib/bootstrap.js";
import { verifyMissionCloseout } from "./lib/closeout.js";
import { runDoctor } from "./lib/doctor.js";
import { ingestIngressEvent } from "./lib/ingress.js";
import { createJob, readJob, writePacket } from "./lib/jobs.js";
import { createMission, writeMission } from "./lib/missions.js";
import { recordReport } from "./lib/reporting.js";
import { ensureRuntimeLayout, readJson, runtimePath } from "./lib/runtime.js";
import { runSmokeScenario } from "./lib/smoke.js";
import { acquireSupervisorLease, supervisorTick } from "./lib/supervisor.js";
import { runWorker } from "./lib/worker-runner.js";
import { executeMissionFlow } from "./lib/orchestrator.js";
import { resolveRepoRoot } from "./lib/root.js";
import { attachSession, readSessionStatus, startSession, stopSession } from "./lib/session-manager.js";

const cwd = resolveRepoRoot(import.meta.url);

function usage() {
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

async function printStatus(root, missionId) {
  if (missionId) {
    const mission = await readJson(runtimePath(root, "missions", `${missionId}.json`));
    console.log(JSON.stringify(mission, null, 2));
    return;
  }

  const missions = (await fs.readdir(runtimePath(root, "missions")).catch(() => [])).filter((file) =>
    file.endsWith(".json"),
  );
  const jobs = (await fs.readdir(runtimePath(root, "jobs")).catch(() => [])).filter((file) =>
    file.endsWith(".json"),
  );
  const supervisor = await readJson(runtimePath(root, "state", "supervisor.json"), null);
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

async function main() {
  const [, , command, ...args] = process.argv;
  if (!command || command === "-h" || command === "--help") {
    usage();
    return;
  }

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
    const [_, messageId, ...requestParts] = args;
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
    const [missionId, category, priorityFloor, ...requestParts] = args;
    const mission = createMission({
      missionId,
      ingressKey: `manual:${missionId}`,
      userRequest: requestParts.join(" "),
      category,
      priorityFloor,
    });
    await writeMission(cwd, mission);
    console.log(JSON.stringify(mission, null, 2));
    return;
  }

  if (command === "create-job") {
    const [missionId, worker, category, priority, task, deliverable] = args;
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
    const [jobId, packetPath] = args;
    const packet = JSON.parse(await fs.readFile(packetPath, "utf8"));
    const result = await writePacket(cwd, jobId, packet);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "run-worker") {
    const [role, jobId] = args;
    const result = await runWorker(cwd, role, jobId);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "supervisor" && args[0] === "lease") {
    const result = await acquireSupervisorLease(cwd, { ownerPid: args[1] ?? String(process.pid) });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "supervisor" && args[0] === "tick") {
    const result = await supervisorTick(cwd, { ownerPid: args[1] ?? String(process.pid) });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "supervisor" && args[0] === "daemon") {
    const ownerPid = args[1] ?? String(process.pid);
    const intervalMs = Number(process.env.CO_SUPERVISOR_INTERVAL_MS ?? 30_000);
    await acquireSupervisorLease(cwd, { ownerPid });
    console.log(JSON.stringify({ ok: true, ownerPid, intervalMs }, null, 2));
    setInterval(async () => {
      try {
        const result = await supervisorTick(cwd, { ownerPid });
        if (result.retried.length > 0 || result.failed.length > 0 || result.recoveredIngresses.length > 0) {
          console.log(JSON.stringify(result));
        }
      } catch (error) {
        console.error(error.stack || error.message);
      }
    }, intervalMs);
    return;
  }

  if (command === "smoke") {
    const result = await runSmokeScenario(cwd, {
      claudeBin: process.env.CLAUDE_BIN,
      extraArgs: process.env.CO_SMOKE_EXTRA_ARGS_JSON
        ? JSON.parse(process.env.CO_SMOKE_EXTRA_ARGS_JSON)
        : undefined,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "dispatch") {
    const [messageId, ...requestParts] = args;
    const result = await executeMissionFlow(cwd, {
      source: "discord",
      messageId,
      chatId: "cli",
      request: requestParts.join(" ").trim(),
      claudeBin: process.env.CLAUDE_BIN,
      extraArgs: process.env.CO_SMOKE_EXTRA_ARGS_JSON
        ? JSON.parse(process.env.CO_SMOKE_EXTRA_ARGS_JSON)
        : undefined,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "closeout" && args[0] === "verify") {
    const result = await verifyMissionCloseout(cwd, args[1]);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "report") {
    const [missionId, reportKey, stage, role, tier, completed, findings, next] = args;
    const result = await recordReport(cwd, {
      missionId,
      reportKey,
      stage,
      role,
      tier,
      completed,
      findings,
      next,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  usage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
