import type { ReportRecord } from "../types/domain.js";

function joinLines(lines: string[]): string {
  return lines.filter((line) => line.trim() !== "").join("\n");
}

export function renderDiscordReportBriefing(report: ReportRecord): string {
  return joinLines([
    "---",
    `[${report.stage}] ${report.request_brief}`,
    report.snapshot,
    report.completed,
    `다음: ${report.next}`,
    `담당: ${report.role} / ${report.tier}`,
  ]);
}

export function renderDiscordFinalMessage(input: {
  requestBrief: string;
  missionId: string;
  worker: string;
  tier: string;
  summaryPath: string;
  closeoutStatus: string;
}): string {
  return joinLines([
    "---",
    `[최종 결과] ${input.requestBrief}`,
    "상태: 완료",
    `mission: ${input.missionId}`,
    `worker: ${input.worker} / ${input.tier}`,
    `summary: ${input.summaryPath}`,
    `closeout: ${input.closeoutStatus}`,
  ]);
}

export function renderDiscordFollowUpBriefing(input: {
  requestBrief: string;
  stage: string;
  statusLine: string;
  detailLine: string;
  nextLine: string;
  role: string;
  tier: string;
}): string {
  return joinLines([
    "---",
    `[${input.stage}] ${input.requestBrief}`,
    input.statusLine,
    input.detailLine,
    `다음: ${input.nextLine}`,
    `담당: ${input.role} / ${input.tier}`,
  ]);
}
