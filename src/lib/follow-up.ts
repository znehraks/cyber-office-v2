import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { Job, ReportRecord } from "../types/domain.js";
import { renderDiscordFollowUpBriefing } from "./discord-briefing.js";
import { clearEpicMission, findEpicByThreadId } from "./epics.js";
import { listJobsForMission, readPacket } from "./jobs.js";
import { readMission } from "./missions.js";
import { listMissionReports } from "./reporting.js";
import { missionNotePath } from "./projects.js";
import { queueAfterThisFollowUp } from "./requests.js";
import {
  canonicalDeliverableFileName,
  readResultFile,
  resultFilePath,
} from "./results.js";
import { exists, runtimePath } from "./runtime.js";

const REPORT_ORDER: Record<string, number> = {
  "mission.created": 1,
  "job.routed": 2,
  "handoff.completed": 3,
  "job.retried": 4,
  "mission.completed": 5,
};

function pickLatestReport(reports: ReportRecord[]): ReportRecord | null {
  return reports.reduce<ReportRecord | null>((latest, current) => {
    if (!latest) {
      return current;
    }

    const left = REPORT_ORDER[latest.report_key] ?? 0;
    const right = REPORT_ORDER[current.report_key] ?? 0;
    return right >= left ? current : latest;
  }, null);
}

function pickLatestJob(jobs: Job[]): Job | null {
  return jobs.at(-1) ?? null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function withPeriod(value: string): string {
  const normalized = normalizeWhitespace(value);
  if (normalized === "") {
    return "";
  }
  return /[.!?]$/u.test(normalized) ? normalized : `${normalized}.`;
}

function extractMarkdownSection(
  markdown: string,
  heading: string,
): string | null {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const sectionMatch = new RegExp(
    `##\\s*${escapedHeading}\\s+([\\s\\S]*?)(?:\\n##\\s+|\\n---|$)`,
    "u",
  ).exec(markdown);
  return sectionMatch?.[1] ?? null;
}

function extractFirstNarrativeLine(markdown: string): string | null {
  const section = markdown;
  for (const rawLine of section.split("\n")) {
    const line = normalizeWhitespace(rawLine);
    if (
      line === "" ||
      line.startsWith("#") ||
      line.startsWith("|") ||
      /^[-*]\s+/u.test(line) ||
      /^```/u.test(line)
    ) {
      continue;
    }
    return withPeriod(
      line
        .replace(/\*\*/gu, "")
        .replace(/`/gu, "")
        .replace(/\[\[([^\]]+)\]\]/gu, "$1"),
    );
  }
  return null;
}

function extractSummaryNarrative(summary: string): string | null {
  return extractFirstNarrativeLine(
    extractMarkdownSection(summary, "실제 만든 것") ?? summary,
  );
}

async function readProgressDetail(
  root: string,
  latestJob: Job,
): Promise<string | null> {
  const artifactDir = runtimePath(root, "artifacts", latestJob.job_id);
  const resultPath = resultFilePath(artifactDir);
  if (await exists(resultPath)) {
    const result = await readResultFile(artifactDir);
    return withPeriod(result.result_summary);
  }

  const summaryPath = path.join(artifactDir, "summary.md");
  if (await exists(summaryPath)) {
    const summary = await fs.readFile(summaryPath, "utf8");
    return extractSummaryNarrative(summary);
  }

  const packet = await readPacket(root, latestJob.job_id);
  const packetCanonicalName =
    packet?.canonical_deliverable_name ??
    canonicalDeliverableFileName(packet?.outcome_kind ?? "research_brief");
  for (const canonicalName of [
    packetCanonicalName,
    "IMPLEMENTATION.md",
    "DESIGN.md",
    "PLAN.md",
    "RESEARCH.md",
  ]) {
    const canonicalPath = path.join(artifactDir, canonicalName);
    if (!(await exists(canonicalPath))) {
      continue;
    }
    const canonical = await fs.readFile(canonicalPath, "utf8");
    const narrative = extractFirstNarrativeLine(
      extractMarkdownSection(canonical, "구현된 기능") ??
        extractMarkdownSection(canonical, "실제로 만든 것") ??
        extractMarkdownSection(canonical, "핵심 결과") ??
        canonical,
    );
    if (narrative) {
      return narrative;
    }
  }

  return null;
}

async function describeFollowUpStatus(
  root: string,
  latestReport: ReportRecord | null,
  latestJob: Job | null,
): Promise<{ statusLine: string; detailLine: string; nextLine: string }> {
  if (latestJob?.status === "failed") {
    return {
      statusLine:
        "현재 담당 작업이 오류로 멈춰 있어 복구 경로와 다음 대응을 정리하는 중입니다.",
      detailLine:
        latestReport?.completed ??
        "최근 실행에서 오류가 발생해 상태를 다시 점검하고 있습니다.",
      nextLine:
        latestReport?.next ?? "오류 원인을 정리해 후속 조치를 안내드립니다.",
    };
  }

  if (latestReport?.stage === "결과 확보") {
    return {
      statusLine:
        "현재 결과물은 확보됐고, 마감 문서 정리와 완료 조건 점검을 진행 중입니다.",
      detailLine: latestReport.completed,
      nextLine: latestReport.next,
    };
  }

  if (latestReport?.stage === "마감 점검") {
    return {
      statusLine:
        "현재 마감 가능 여부를 확인 중이며, 재시도 없이 끝낼지 추가 보완이 필요한지 판단하는 단계입니다.",
      detailLine: latestReport.completed,
      nextLine: latestReport.next,
    };
  }

  if (latestJob?.status === "running") {
    const progressDetail = await readProgressDetail(root, latestJob);
    const taskLabel = normalizeWhitespace(latestJob.input.task);
    return {
      statusLine:
        taskLabel === ""
          ? `현재 ${latestJob.worker} / ${latestJob.tier}가 작업을 이어가고 있습니다.`
          : `현재 ${latestJob.worker} / ${latestJob.tier}가 ${taskLabel} 작업을 이어가고 있습니다.`,
      detailLine:
        progressDetail ??
        "현재 요청하신 범위를 실제로 구현하거나 정리하는 중이며, 눈에 보이는 결과가 정리되는 대로 바로 다시 보고드리겠습니다.",
      nextLine:
        latestReport?.next ??
        "중간 산출물 정리 후 다음 진행 상황을 이어서 보고드립니다.",
    };
  }

  if (latestReport) {
    return {
      statusLine: `현재 ${latestReport.stage} 단계까지 진행됐고, 최신 상태를 기준으로 작업 흐름을 이어가고 있습니다.`,
      detailLine: latestReport.completed,
      nextLine: latestReport.next,
    };
  }

  return {
    statusLine:
      "현재 요청은 접수된 상태이며, 담당 배정과 실행 준비를 계속 진행하고 있습니다.",
    detailLine:
      "아직 사용자에게 공유된 진행 보고는 없지만, 작업 상태를 내부에서 확인 중입니다.",
    nextLine: "담당 배정과 첫 진행 보고를 이어서 정리합니다.",
  };
}

export async function buildFollowUpReply(
  root: string,
  threadId: string,
): Promise<{ missionId: string; content: string } | null> {
  const epic = await findEpicByThreadId(root, threadId);
  if (!epic?.active_mission_id) {
    return null;
  }

  const mission = await readMission(root, epic.active_mission_id);
  if (!mission) {
    return null;
  }
  if (mission.status === "completed" || mission.closeout.status === "passed") {
    await clearEpicMission(root, epic.epic_id, mission.mission_id);
    return null;
  }

  const [reports, jobs] = await Promise.all([
    listMissionReports(root, mission.mission_id),
    listJobsForMission(root, mission.mission_id),
  ]);
  const latestReport = pickLatestReport(reports);
  const latestJob = pickLatestJob(jobs);
  const status = await describeFollowUpStatus(root, latestReport, latestJob);
  return {
    missionId: mission.mission_id,
    content: renderDiscordFollowUpBriefing({
      requestText: mission.user_request,
      statusLine: status.statusLine,
      detailLine: status.detailLine,
      nextLine: status.nextLine,
      role: "ceo",
      tier: "standard",
      notePath: missionNotePath(
        mission.project_ref,
        mission.epic_ref.slug,
        mission.mission_id,
      ),
    }),
  };
}

export async function handleActiveMissionThreadInput(
  root: string,
  input: {
    threadId: string;
    requestingUserId: string;
    content: string;
  },
): Promise<
  | { kind: "status"; content: string; missionId: string }
  | { kind: "queued"; content: string }
  | { kind: "rejected"; content: string }
> {
  const normalized = input.content.trim();
  if (normalized.toLowerCase() === "status") {
    const reply = await buildFollowUpReply(root, input.threadId);
    if (!reply) {
      return {
        kind: "rejected",
        content: "현재 진행 중인 mission이 없어 상태를 보고할 수 없습니다.",
      };
    }
    return {
      kind: "status",
      content: reply.content,
      missionId: reply.missionId,
    };
  }

  if (/^after-this:\s+\S/iu.test(normalized)) {
    await queueAfterThisFollowUp(root, {
      epicThreadId: input.threadId,
      requestingUserId: input.requestingUserId,
      requestText: normalized,
    });
    return {
      kind: "queued",
      content:
        "현재 작업이 끝나는 즉시 이어서 처리할 후속 요청으로 등록했습니다. 진행 중에는 `status`, 예약은 `after-this:`만 받습니다.",
    };
  }

  return {
    kind: "rejected",
    content:
      "현재 mission이 진행 중입니다. 상태 확인은 `status`, 다음 요청 예약은 `after-this: <요청>` 형식으로 보내주세요.",
  };
}
