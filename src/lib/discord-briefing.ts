import type { ReportRecord } from "../types/domain.js";
import {
  createPublicBriefingTitle,
  createPublicRequestLead,
} from "./ceo-reporting.js";

function joinLines(lines: string[]): string {
  return lines.filter((line) => line.trim() !== "").join("\n");
}

interface DiscordBriefingOptions {
  requestText?: string | undefined;
}

type PublicStage = "접수" | "진행" | "보완 진행";

function resolveRequestText(
  report: ReportRecord,
  options: DiscordBriefingOptions,
): string {
  return options.requestText ?? report.request_brief;
}

function resolvePublicStage(report: ReportRecord): PublicStage | null {
  if (report.report_key === "job.routed") {
    return "접수";
  }
  if (report.report_key === "handoff.completed") {
    return "진행";
  }
  if (
    report.report_key === "job.retried" &&
    report.evidence !== null &&
    report.evidence !== "재시도 없음"
  ) {
    return "보완 진행";
  }
  return null;
}

function toPhaseLabel(stage: PublicStage): "intake" | "progress" | "retry" {
  switch (stage) {
    case "접수":
      return "intake";
    case "진행":
      return "progress";
    case "보완 진행":
      return "retry";
  }
}

export function renderDiscordReportBriefing(
  report: ReportRecord,
  options: DiscordBriefingOptions = {},
): string | null {
  const publicStage = resolvePublicStage(report);
  if (publicStage === null) {
    return null;
  }
  const requestText = resolveRequestText(report, options);
  const phase = toPhaseLabel(publicStage);
  return joinLines([
    "---",
    `[${publicStage}] ${createPublicBriefingTitle(requestText, phase)}`,
    createPublicRequestLead(requestText, phase),
    report.completed,
    `다음: ${report.next}`,
    `담당: ${report.role} / ${report.tier}`,
  ]);
}

export function renderDiscordFinalMessage(input: {
  requestText: string;
  missionId: string;
  worker: string;
  tier: string;
  resultSummary: string;
  nextStep: string;
  notePath: string;
  summaryPath?: string | undefined;
  closeoutStatus: string;
}): string {
  return joinLines([
    "---",
    `[최종 결과] ${createPublicBriefingTitle(input.requestText, "final")}`,
    createPublicRequestLead(input.requestText, "final"),
    `결과: ${input.resultSummary}`,
    `다음: ${input.nextStep}`,
    `worker: ${input.worker} / ${input.tier}`,
    `mission: ${input.missionId}`,
    `note: ${input.notePath}`,
    `closeout: ${input.closeoutStatus}`,
  ]);
}

export function renderDiscordFollowUpBriefing(input: {
  requestText: string;
  statusLine: string;
  detailLine: string;
  nextLine: string;
  role: string;
  tier: string;
}): string {
  return joinLines([
    "---",
    `[진행 상태] ${createPublicBriefingTitle(input.requestText, "status")}`,
    createPublicRequestLead(input.requestText, "status"),
    input.statusLine,
    input.detailLine,
    `다음: ${input.nextLine}`,
    `담당: ${input.role} / ${input.tier}`,
  ]);
}
