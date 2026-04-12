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
import {
  renderDiscordFinalMessage,
  renderDiscordReportBriefing,
} from "./lib/discord-briefing.js";
import {
  parseEpicHeader,
  parseResolutionChoice,
  parseWorkspaceBinding,
  shouldHandleCeoIngress,
  stripBotMention,
} from "./lib/discord-routing.js";
import { runDoctor } from "./lib/doctor.js";
import { loadRuntimeEnv } from "./lib/env.js";
import {
  clearPendingEpicResolution,
  createEpicRecord,
  createPendingEpicResolution,
  findEpicByThreadId,
  findPendingEpicResolution,
  normalizeEpicTitle,
  resolveEpicRequest,
} from "./lib/epics.js";
import { appendEvent } from "./lib/events.js";
import {
  buildFollowUpReply,
  handleActiveMissionThreadInput,
} from "./lib/follow-up.js";
import {
  classifyRequest,
  executeMissionFlow,
  parseGodCommand,
} from "./lib/orchestrator.js";
import {
  epicNotePath,
  projectOperationsDir,
  resolveObsidianProjectsRoot,
  resolveProjectByChannelId,
  resolveProjectBySlug,
} from "./lib/projects.js";
import { parseRequestExecutionControls } from "./lib/request-controls.js";
import {
  claimPreMissionRequest,
  clearPendingWorkspaceRequest,
  clearQueuedFollowUp,
  createPendingWorkspaceRequest,
  findPendingWorkspaceRequestByThread,
  readQueuedFollowUp,
  resolvePendingWorkspaceRequest,
  updatePreMissionClaim,
} from "./lib/requests.js";
import { classifyOutcomeKind } from "./lib/results.js";
import { resolveRepoRoot } from "./lib/root.js";
import { ensureRuntimeLayout } from "./lib/runtime.js";
import { acquireSupervisorLease, supervisorTick } from "./lib/supervisor.js";
import type { EpicRecord, OutcomeKind, ProjectRef } from "./types/domain.js";

interface SendableChannel {
  id: string;
  send(content: string): Promise<unknown>;
}

interface ThreadCapableChannel extends SendableChannel {
  type: number;
  isThread(): boolean;
  threads: {
    create(options: { name: string; reason?: string }): Promise<unknown>;
  };
}

interface ThreadLikeChannel extends SendableChannel {
  id: string;
  isThread(): boolean;
  parentId?: string | null;
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

function isThreadCapableChannel(
  channel: unknown,
): channel is ThreadCapableChannel {
  return (
    typeof channel === "object" &&
    channel !== null &&
    "threads" in channel &&
    typeof channel.threads === "object" &&
    channel.threads !== null &&
    "create" in channel.threads &&
    typeof channel.threads.create === "function" &&
    "id" in channel &&
    typeof channel.id === "string" &&
    "send" in channel &&
    typeof channel.send === "function" &&
    "isThread" in channel &&
    typeof channel.isThread === "function" &&
    "type" in channel &&
    typeof channel.type === "number"
  );
}

function isThreadLikeChannel(channel: unknown): channel is ThreadLikeChannel {
  return (
    typeof channel === "object" &&
    channel !== null &&
    "id" in channel &&
    typeof channel.id === "string" &&
    "send" in channel &&
    typeof channel.send === "function" &&
    "isThread" in channel &&
    typeof channel.isThread === "function"
  );
}

function threadMention(threadId: string): string {
  return `<#${threadId}>`;
}

function truncateThreadName(value: string): string {
  const normalized = value.trim();
  return normalized.length <= 90
    ? normalized
    : normalized.slice(0, 90).trimEnd();
}

function renderRootChannelGuide(): string {
  return "새 요청은 등록된 프로젝트 채널 루트에서 `epic: <제목>` 헤더와 함께 보내주세요.";
}

function renderManagedThreadGuide(): string {
  return "이 thread는 ceo가 관리하는 epic thread가 아닙니다. 등록된 프로젝트 채널 루트에서 `epic: <제목>`으로 시작해 주세요.";
}

function renderPendingResolutionMessage(input: {
  epicTitle: string;
  candidates: { title: string; discord_thread_id: string }[];
}): string {
  const candidateLines = input.candidates.map(
    (candidate, index) =>
      `${String(index + 1)}. ${candidate.title} (${threadMention(candidate.discord_thread_id)})`,
  );
  return [
    `비슷한 열린 epic 후보를 찾았습니다: ${input.epicTitle}`,
    ...candidateLines,
    "같은 채널에서 `1`, `2`, `3` 또는 `new`로 답해주세요.",
  ].join("\n");
}

function renderExistingPendingResolutionMessage(input: {
  epicTitle: string;
  candidates: { title: string; discord_thread_id: string }[];
}): string {
  return [
    "아직 이전 epic 후보 선택이 끝나지 않았습니다.",
    renderPendingResolutionMessage(input),
  ].join("\n");
}

function renderWorkspaceRequestMessage(): string {
  return "이 요청은 작업 경로가 정해져야 착수할 수 있습니다. 이 thread에서 `workspace: /absolute/path` 형식으로 작업공간을 보내주세요.";
}

function renderWorkspaceOnlyRequesterMessage(): string {
  return "이 작업의 workspace는 최초 요청자만 지정할 수 있습니다.";
}

function renderEpicReuseMessage(epic: EpicRecord): string {
  if (epic.active_mission_id) {
    return `같은 epic이 이미 진행 중입니다. ${threadMention(epic.discord_thread_id)}에서 \`status\`로 현재 상태를 확인하거나 \`after-this:\`로 다음 요청을 예약해 주세요.`;
  }
  return `같은 epic이 이미 열려 있습니다. ${threadMention(epic.discord_thread_id)}에서 이어가 주세요.`;
}

async function runMissionInEpicThread(input: {
  messageId: string;
  thread: SendableChannel;
  request: string;
  projectRef: ProjectRef;
  epicRef: EpicRecord;
  outcomeKind?: OutcomeKind | undefined;
  workspacePath?: string | undefined;
  testScenario?: "retry-once" | undefined;
}): Promise<Awaited<ReturnType<typeof executeMissionFlow>>> {
  const result = await executeMissionFlow(root, {
    source: "discord",
    eventType: "message_create",
    messageId: input.messageId,
    chatId: input.thread.id,
    request: input.request,
    projectRef: input.projectRef,
    epicRef: input.epicRef,
    outcomeKind: input.outcomeKind,
    workspacePath: input.workspacePath,
    testScenario: input.testScenario,
    onReport: async (report) => {
      const briefing = renderDiscordReportBriefing(report, {
        requestText: input.request,
      });
      if (briefing !== null) {
        await input.thread.send(briefing);
      }
    },
  });

  await input.thread.send(
    renderDiscordFinalMessage({
      requestText: input.request,
      missionId: result.missionId,
      worker: result.routing.worker,
      tier: result.routing.tier,
      resultSummary: result.resultSummary,
      nextStep: result.nextStep,
      notePath: result.missionNotePath,
      summaryPath: result.workerResult.summaryPath,
      closeoutStatus: result.closeout.status,
    }),
  );
  return result;
}

async function startQueuedFollowUpIfPresent(input: {
  thread: SendableChannel;
  projectRef: ProjectRef;
  epicRef: EpicRecord;
}): Promise<void> {
  const queued = await readQueuedFollowUp(root, input.thread.id);
  if (!queued) {
    return;
  }
  await clearQueuedFollowUp(root, input.thread.id);
  await input.thread.send(
    [
      "---",
      "[다음 작업] 예약된 후속 요청을 이어서 시작합니다.",
      "앞선 mission이 마무리돼 같은 epic에서 다음 요청을 새 mission으로 이어갑니다.",
      `요청: ${queued.request_text.replace(/^after-this:\s*/iu, "")}`,
      "다음: 후속 요청 기준으로 새 진행 브리핑을 이어서 보고드립니다.",
      "담당: ceo / standard",
    ].join("\n"),
  );
  await handleEpicThreadRequest({
    messageId: `queued-${String(Date.now())}`,
    thread: input.thread,
    request: queued.request_text,
    projectRef: input.projectRef,
    epicRef: input.epicRef,
    requestingUserId: queued.requesting_user_id,
  });
}

async function handleEpicThreadRequest(input: {
  messageId: string;
  thread: SendableChannel;
  request: string;
  projectRef: ProjectRef;
  epicRef: EpicRecord;
  requestingUserId: string;
  workspacePath?: string | undefined;
  outcomeKind?: ReturnType<typeof classifyOutcomeKind>;
}): Promise<void> {
  const requestControls = parseRequestExecutionControls(input.request);
  const request = requestControls.cleanedRequest;
  const routing = classifyRequest(request);
  const outcomeKind =
    input.outcomeKind ?? classifyOutcomeKind(request, routing);
  const claim = await claimPreMissionRequest(root, {
    source: "discord",
    eventType: "message_create",
    upstreamEventId: input.messageId,
    channelId: input.thread.id,
    requestingUserId: input.requestingUserId,
  });
  if (!claim.created && claim.status === "materialized") {
    return;
  }

  if (outcomeKind === "code_change" && !input.workspacePath) {
    const pending = await createPendingWorkspaceRequest(root, {
      projectSlug: input.projectRef.project_slug,
      epicId: input.epicRef.epic_id,
      epicThreadId: input.thread.id,
      requestingUserId: input.requestingUserId,
      sourceMessageId: input.messageId,
      originalRequest: request,
      outcomeKind,
    });
    await updatePreMissionClaim(root, claim.key_hash, {
      status: "awaiting_workspace",
      workspace_request_id: pending.workspace_request_id,
    });
    await input.thread.send(renderWorkspaceRequestMessage());
    return;
  }

  const result = await runMissionInEpicThread({
    messageId: input.messageId,
    thread: input.thread,
    request,
    projectRef: input.projectRef,
    epicRef: input.epicRef,
    outcomeKind,
    workspacePath: input.workspacePath,
    testScenario: requestControls.testScenario ?? undefined,
  });
  await updatePreMissionClaim(root, claim.key_hash, {
    status: "materialized",
    mission_id: result.missionId,
  });
  await startQueuedFollowUpIfPresent({
    thread: input.thread,
    projectRef: input.projectRef,
    epicRef: input.epicRef,
  });
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

  if (message.channel.type === ChannelType.DM) {
    await message.reply(
      "DM에서는 새 요청을 받지 않습니다. 등록된 프로젝트 채널 루트에서 `epic: <제목>`과 함께 요청해 주세요.",
    );
    return;
  }

  if (isThreadLikeChannel(message.channel) && message.channel.isThread()) {
    const epic = await findEpicByThreadId(root, message.channel.id);
    if (!epic) {
      await message.reply(renderManagedThreadGuide());
      return;
    }
    const projectRef = await resolveProjectBySlug(root, epic.project_slug);
    if (!projectRef) {
      throw new Error(`Project missing for epic: ${epic.project_slug}`);
    }

    const pendingWorkspace = await findPendingWorkspaceRequestByThread(
      root,
      message.channel.id,
    );
    if (pendingWorkspace) {
      const workspacePath = parseWorkspaceBinding(content);
      if (workspacePath === null) {
        await message.reply(renderWorkspaceRequestMessage());
        return;
      }
      if (pendingWorkspace.requesting_user_id !== message.author.id) {
        await message.reply(renderWorkspaceOnlyRequesterMessage());
        return;
      }
      const resolved = await resolvePendingWorkspaceRequest(root, {
        epicThreadId: message.channel.id,
        requestingUserId: message.author.id,
        workspacePath,
        repoRoot: root,
        projectOperationsDir: projectOperationsDir(projectRef),
        obsidianProjectsRoot: resolveObsidianProjectsRoot(),
      });
      await clearPendingWorkspaceRequest(root, message.channel.id);
      await handleEpicThreadRequest({
        messageId: pendingWorkspace.source_message_id,
        thread: message.channel,
        request: pendingWorkspace.original_request,
        projectRef,
        epicRef: epic,
        requestingUserId: message.author.id,
        workspacePath: resolved.workspace_path ?? undefined,
        outcomeKind: pendingWorkspace.outcome_kind,
      });
      return;
    }

    const followUp = await buildFollowUpReply(root, message.channel.id);
    if (followUp) {
      const action = await handleActiveMissionThreadInput(root, {
        threadId: message.channel.id,
        requestingUserId: message.author.id,
        content,
      });
      await message.channel.send(action.content);
      return;
    }

    await handleEpicThreadRequest({
      messageId: message.id,
      thread: message.channel,
      request: content,
      projectRef,
      epicRef: epic,
      requestingUserId: message.author.id,
    });
    return;
  }

  const projectRef = await resolveProjectByChannelId(root, message.channel.id);
  if (!projectRef) {
    await message.reply(renderRootChannelGuide());
    return;
  }

  const pending = await findPendingEpicResolution(root, {
    channelId: message.channel.id,
    requestingUserId: message.author.id,
  });
  const resolutionChoice = parseResolutionChoice(content);
  if (pending && !resolutionChoice) {
    await message.reply(
      renderExistingPendingResolutionMessage({
        epicTitle: pending.epic_title,
        candidates: pending.candidates,
      }),
    );
    return;
  }
  if (pending && resolutionChoice) {
    await clearPendingEpicResolution(
      root,
      message.channel.id,
      message.author.id,
    );
    if (resolutionChoice.kind === "candidate") {
      const selected = pending.candidates[resolutionChoice.index];
      if (!selected) {
        await message.reply("선택한 후보가 없습니다. 다시 요청해 주세요.");
        return;
      }
      await appendEvent(
        root,
        "epic.resolution.selected",
        {
          project_slug: pending.project_slug,
          channel_id: pending.channel_id,
          epic_id: selected.epic_id,
        },
        { idempotencyKey: pending.resolution_id },
      );
      await message.reply(
        `기존 epic은 ${threadMention(selected.discord_thread_id)} 입니다. 그 thread에서 이어가 주세요.`,
      );
      return;
    }

    if (!isThreadCapableChannel(message.channel)) {
      throw new Error("Project channel cannot create threads");
    }
    const thread = await message.channel.threads.create({
      name: truncateThreadName(pending.epic_title),
      reason: `epic:${pending.epic_title}`,
    });
    assertSendableChannel(thread);
    const epic = await createEpicRecord(root, {
      projectSlug: projectRef.project_slug,
      title: pending.epic_title,
      discordThreadId: thread.id,
      obsidianNoteRef: epicNotePath(
        projectRef,
        normalizeEpicTitle(pending.epic_title),
      ),
    });
    await message.reply(
      `새 epic thread ${threadMention(thread.id)}를 열고 요청을 시작했습니다.`,
    );
    await handleEpicThreadRequest({
      messageId: pending.source_message_id,
      thread,
      request: pending.request_body,
      projectRef,
      epicRef: epic,
      requestingUserId: message.author.id,
    });
    return;
  }

  const parsedHeader = parseEpicHeader(content);
  if (!parsedHeader) {
    await message.reply(renderRootChannelGuide());
    return;
  }

  const rootClaim = await claimPreMissionRequest(root, {
    source: "discord",
    eventType: "message_create",
    upstreamEventId: message.id,
    channelId: message.channel.id,
    requestingUserId: message.author.id,
  });
  if (!rootClaim.created && rootClaim.status === "cancelled") {
    return;
  }

  const resolution = await resolveEpicRequest(root, {
    projectSlug: projectRef.project_slug,
    title: parsedHeader.epicTitle,
  });

  if (resolution.kind === "exact") {
    await updatePreMissionClaim(root, rootClaim.key_hash, {
      status: "cancelled",
    });
    await appendEvent(
      root,
      "epic.reused",
      {
        project_slug: projectRef.project_slug,
        epic_id: resolution.epic.epic_id,
        channel_id: message.channel.id,
      },
      { idempotencyKey: `${message.id}:${resolution.epic.epic_id}:reuse` },
    );
    await message.reply(renderEpicReuseMessage(resolution.epic));
    return;
  }

  if (resolution.kind === "candidates") {
    await createPendingEpicResolution(root, {
      projectSlug: projectRef.project_slug,
      channelId: message.channel.id,
      sourceMessageId: message.id,
      requestingUserId: message.author.id,
      epicTitle: parsedHeader.epicTitle,
      requestBody: parsedHeader.requestBody,
      requestText: content,
      candidates: resolution.candidates,
    });
    await updatePreMissionClaim(root, rootClaim.key_hash, {
      status: "cancelled",
    });
    await message.reply(
      renderPendingResolutionMessage({
        epicTitle: parsedHeader.epicTitle,
        candidates: resolution.candidates,
      }),
    );
    return;
  }

  if (!isThreadCapableChannel(message.channel)) {
    throw new Error("Project channel cannot create threads");
  }
  const thread = await message.channel.threads.create({
    name: truncateThreadName(parsedHeader.epicTitle),
    reason: `epic:${parsedHeader.epicTitle}`,
  });
  assertSendableChannel(thread);
  const epic = await createEpicRecord(root, {
    projectSlug: projectRef.project_slug,
    title: parsedHeader.epicTitle,
    discordThreadId: thread.id,
    obsidianNoteRef: epicNotePath(projectRef, resolution.slug),
  });
  await message.reply(
    `새 epic thread ${threadMention(thread.id)}를 열고 요청을 시작했습니다.`,
  );
  await handleEpicThreadRequest({
    messageId: message.id,
    thread,
    request: parsedHeader.requestBody,
    projectRef,
    epicRef: epic,
    requestingUserId: message.author.id,
  });
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
      const content = stripBotMention(message, client);
      const isManagedEpicThread =
        isThreadLikeChannel(message.channel) &&
        message.channel.isThread() &&
        (await findEpicByThreadId(root, message.channel.id)) !== null;
      const hasPendingResolutionChoice =
        !isDM &&
        !mentioned &&
        (await findPendingEpicResolution(root, {
          channelId: message.channel.id,
          requestingUserId: message.author.id,
        })) !== null &&
        parseResolutionChoice(content) !== null;

      if (
        !shouldHandleCeoIngress({
          isDm: isDM,
          mentioned,
          isManagedEpicThread,
          hasPendingResolutionChoice,
        })
      ) {
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
