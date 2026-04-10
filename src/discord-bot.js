#!/usr/bin/env node
import process from "node:process";

import {
  ChannelType,
  Client,
  GatewayIntentBits,
  Partials,
} from "discord.js";

import { bootstrapRuntimeWorkers } from "./lib/bootstrap.js";
import { ensureReplyChannel, stripBotMention } from "./lib/discord-routing.js";
import { executeMissionFlow, parseGodCommand } from "./lib/orchestrator.js";
import { acquireSupervisorLease, supervisorTick } from "./lib/supervisor.js";
import { ensureRuntimeLayout } from "./lib/runtime.js";
import { runDoctor } from "./lib/doctor.js";
import { resolveRepoRoot } from "./lib/root.js";

const root = resolveRepoRoot(import.meta.url);
const botRole = (process.env.CO_DISCORD_ROLE ?? "ceo").toLowerCase();
const token =
  botRole === "god" ? process.env.DISCORD_GOD_BOT_TOKEN : process.env.DISCORD_CEO_BOT_TOKEN;
const adminIds = new Set(
  String(process.env.DISCORD_ADMIN_USER_IDS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);

if (!token) {
  throw new Error(
    botRole === "god"
      ? "DISCORD_GOD_BOT_TOKEN is required"
      : "DISCORD_CEO_BOT_TOKEN is required",
  );
}

async function handleCeoMessage(message, client) {
  const content = stripBotMention(message, client);
  if (!content) return;

  const replyChannel = await ensureReplyChannel(message);
  await replyChannel.send(
    [
      "요청 잘 받았습니다. 바로 확인해서 진행해볼게요.",
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
      "작업이 마무리됐습니다. 아래 결과를 확인하시면 됩니다.",
      "",
      `mission: ${result.missionId}`,
      `worker: ${result.routing.worker} / ${result.routing.tier}`,
      `summary: ${result.workerResult.summaryPath}`,
      `closeout: ${result.closeout.status}`,
    ].join("\n"),
  );
}

async function handleGodMessage(message) {
  if (adminIds.size > 0 && !adminIds.has(message.author.id)) {
    await message.reply("Not authorized.");
    return;
  }

  const parsed = parseGodCommand(message.content);
  if (!parsed) {
    await message.reply("지원 명령: status | doctor | supervisor lease | supervisor tick | supervisor daemon");
    return;
  }

  if (parsed.command === "status") {
    const { default: fs } = await import("node:fs/promises");
    const missions = (await fs.readdir(`${root}/runtime/missions`).catch(() => [])).filter((x) => x.endsWith(".json"));
    const jobs = (await fs.readdir(`${root}/runtime/jobs`).catch(() => [])).filter((x) => x.endsWith(".json"));
    await message.reply(`missions=${missions.length}\njobs=${jobs.length}`);
    return;
  }

  if (parsed.command === "doctor") {
    const result = await runDoctor(root);
    await message.reply(`doctor ok=${result.ok} roles=${result.roles} worker_dirs=${result.worker_dirs}`);
    return;
  }

  if (parsed.command === "supervisor" && parsed.args[0] === "lease") {
    const lease = await acquireSupervisorLease(root, { ownerPid: `god-${process.pid}` });
    await message.reply(`lease owner=${lease.owner_pid}`);
    return;
  }

  if (parsed.command === "supervisor" && parsed.args[0] === "tick") {
    const tick = await supervisorTick(root, { ownerPid: `god-${process.pid}` });
    await message.reply(`tick retried=${tick.retried.length} failed=${tick.failed.length}`);
    return;
  }

  if (parsed.command === "supervisor" && parsed.args[0] === "daemon") {
    await acquireSupervisorLease(root, { ownerPid: `god-${process.pid}` });
    setInterval(async () => {
      await supervisorTick(root, { ownerPid: `god-${process.pid}` }).catch((error) => {
        process.stderr.write(`${error.stack || error.message}\n`);
      });
    }, Number(process.env.CO_SUPERVISOR_INTERVAL_MS ?? 30_000));
    await message.reply("supervisor daemon started");
  }
}

async function main() {
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
    process.stdout.write(`discord bot ready: ${botRole}:${client.user?.tag}\n`);
  });

  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    if (botRole === "ceo") {
      const isDM = message.channel.type === ChannelType.DM;
      const mentioned = client.user ? message.mentions.has(client.user) : false;
      if (!isDM && !mentioned) return;
      await handleCeoMessage(message, client).catch(async (error) => {
        await message.reply(`진행 중 오류가 발생했습니다.\nceo error: ${error.message}`);
      });
      return;
    }

    const isDM = message.channel.type === ChannelType.DM;
    const mentioned = client.user ? message.mentions.has(client.user) : false;
    if (!isDM && !mentioned) return;
    await handleGodMessage(message).catch(async (error) => {
      await message.reply(`관리자 작업 중 오류가 발생했습니다.\ngod error: ${error.message}`);
    });
  });

  await client.login(token);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
