#!/usr/bin/env node
import * as fs from "node:fs/promises";
import * as process from "node:process";

import {
  ChannelType,
  Client,
  GatewayIntentBits,
  type Message,
  Partials,
} from "discord.js";

import { bootstrapRuntimeWorkers } from "./lib/bootstrap.js";
import { ensureReplyChannel, stripBotMention } from "./lib/discord-routing.js";
import { runDoctor } from "./lib/doctor.js";
import { loadRuntimeEnv } from "./lib/env.js";
import { executeMissionFlow, parseGodCommand } from "./lib/orchestrator.js";
import { resolveRepoRoot } from "./lib/root.js";
import { ensureRuntimeLayout } from "./lib/runtime.js";
import { acquireSupervisorLease, supervisorTick } from "./lib/supervisor.js";

interface SendableChannel {
  id: string;
  send(content: string): Promise<unknown>;
}

function assertSendableChannel(
  channel: unknown,
): asserts channel is SendableChannel {
  if (
    typeof channel !== "object" ||
    channel === null ||
    !("id" in channel) ||
    typeof channel.id !== "string" ||
    !("send" in channel) ||
    typeof channel.send !== "function"
  ) {
    throw new Error("Reply channel is not sendable");
  }
}

const root = resolveRepoRoot(import.meta.url);

function parseAdminIds(raw: string): Set<string> {
  return new Set(
    raw
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== ""),
  );
}

function buildConfig(): {
  botRole: string;
  token: string;
  adminIds: Set<string>;
} {
  const botRole = (process.env["CO_DISCORD_ROLE"] ?? "ceo").toLowerCase();
  const token =
    botRole === "god"
      ? (process.env["DISCORD_GOD_BOT_TOKEN"] ?? "")
      : (process.env["DISCORD_CEO_BOT_TOKEN"] ?? "");
  const adminIds = parseAdminIds(process.env["DISCORD_ADMIN_USER_IDS"] ?? "");
  if (token === "") {
    throw new Error(
      botRole === "god"
        ? "DISCORD_GOD_BOT_TOKEN is required"
        : "DISCORD_CEO_BOT_TOKEN is required",
    );
  }
  return { botRole, token, adminIds };
}

async function handleCeoMessage(
  message: Message,
  client: Client,
): Promise<void> {
  const content = stripBotMention(message, client);
  if (content === "") {
    return;
  }

  const replyChannel = await ensureReplyChannel(message);
  assertSendableChannel(replyChannel);
  await replyChannel.send(
    [
      "요청 확인했습니다. 바로 분류해서 진행 상황을 계속 공유드릴게요.",
      "",
      "현재 단계: 요청 접수",
      "role / tier: ceo / standard",
      "방금 한 일: 요청을 받음",
      "발견: 실행 준비",
      "다음 일: 분류 및 worker 배정",
    ].join("\n"),
  );

  const result = await executeMissionFlow(root, {
    source: "discord",
    eventType: "message_create",
    messageId: message.id,
    chatId: replyChannel.id,
    request: content,
    onReport: async (report) => {
      await replyChannel.send(report.content);
    },
  });

  await replyChannel.send(
    [
      "작업이 마무리되었습니다. 결과 경로와 상태를 아래에 정리해둘게요.",
      "",
      `mission: ${result.missionId}`,
      `worker: ${result.routing.worker} / ${result.routing.tier}`,
      `summary: ${result.workerResult.summaryPath}`,
      `closeout: ${result.closeout.status}`,
    ].join("\n"),
  );
}

async function handleGodMessage(
  message: Message,
  adminIds: Set<string>,
): Promise<void> {
  if (adminIds.size > 0 && !adminIds.has(message.author.id)) {
    await message.reply("Not authorized.");
    return;
  }

  const parsed = parseGodCommand(message.content);
  if (!parsed) {
    await message.reply(
      "지원 명령: status | doctor | supervisor lease | supervisor tick | supervisor daemon",
    );
    return;
  }

  if (parsed.command === "status") {
    const missions = (
      await fs.readdir(`${root}/runtime/missions`).catch(() => [] as string[])
    ).filter((file) => file.endsWith(".json"));
    const jobs = (
      await fs.readdir(`${root}/runtime/jobs`).catch(() => [] as string[])
    ).filter((file) => file.endsWith(".json"));
    await message.reply(
      `missions=${String(missions.length)}\njobs=${String(jobs.length)}`,
    );
    return;
  }

  if (parsed.command === "doctor") {
    const result = await runDoctor(root);
    await message.reply(
      `doctor ok=${String(result.ok)} roles=${String(result.roles)} worker_dirs=${String(result.worker_dirs)}`,
    );
    return;
  }

  if (parsed.command === "supervisor" && parsed.args[0] === "lease") {
    const lease = await acquireSupervisorLease(root, {
      ownerPid: `god-${String(process.pid)}`,
    });
    await message.reply(`lease owner=${lease.owner_pid}`);
    return;
  }

  if (parsed.command === "supervisor" && parsed.args[0] === "tick") {
    const tick = await supervisorTick(root, {
      ownerPid: `god-${String(process.pid)}`,
    });
    await message.reply(
      `tick retried=${String(tick.retried.length)} failed=${String(tick.failed.length)}`,
    );
    return;
  }

  if (parsed.command === "supervisor" && parsed.args[0] === "daemon") {
    await acquireSupervisorLease(root, {
      ownerPid: `god-${String(process.pid)}`,
    });
    setInterval(
      () => {
        void supervisorTick(root, {
          ownerPid: `god-${String(process.pid)}`,
        }).catch((error: unknown) => {
          const messageText =
            error instanceof Error
              ? (error.stack ?? error.message)
              : String(error);
          process.stderr.write(`${messageText}\n`);
        });
      },
      Number(process.env["CO_SUPERVISOR_INTERVAL_MS"] ?? 30_000),
    );
    await message.reply("supervisor daemon started");
  }
}

async function main(): Promise<void> {
  await loadRuntimeEnv();
  const config = buildConfig();

  await ensureRuntimeLayout(root);
  await bootstrapRuntimeWorkers(root);

  const client = new Client({
    intents: [
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  client.once("ready", () => {
    process.stdout.write(
      `discord bot ready: ${config.botRole}:${client.user?.tag ?? "unknown"}\n`,
    );
  });

  client.on("messageCreate", async (message) => {
    if (message.author.bot) {
      return;
    }

    if (config.botRole === "ceo") {
      const isDM = message.channel.type === ChannelType.DM;
      const mentioned = client.user ? message.mentions.has(client.user) : false;
      if (!isDM && !mentioned) {
        return;
      }
      await handleCeoMessage(message, client).catch(async (error: unknown) => {
        const messageText =
          error instanceof Error ? error.message : String(error);
        await message.reply(
          `진행 중 오류가 발생했습니다.\nceo error: ${messageText}`,
        );
      });
      return;
    }

    const isDM = message.channel.type === ChannelType.DM;
    const mentioned = client.user ? message.mentions.has(client.user) : false;
    if (!isDM && !mentioned) {
      return;
    }
    await handleGodMessage(message, config.adminIds).catch(
      async (error: unknown) => {
        const messageText =
          error instanceof Error ? error.message : String(error);
        await message.reply(
          `관리자 작업 중 오류가 발생했습니다.\ngod error: ${messageText}`,
        );
      },
    );
  });

  await client.login(config.token);
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(message);
  globalThis.process.exitCode = 1;
});
