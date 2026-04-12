import * as process from "node:process";

import type { ReportRecord, ResultFile } from "../types/domain.js";
import {
  createPublicBriefingTitle,
  createPublicOutcomeLines,
  createPublicOutcomeNarrative,
  createPublicRequestLead,
} from "./ceo-reporting.js";
import { toObsidianRelativePath } from "./projects.js";

function joinLines(lines: string[]): string {
  return lines.filter((line) => line.trim() !== "").join("\n");
}

interface DiscordBriefingOptions {
  requestText?: string | undefined;
  notePath?: string | undefined;
  obsidianProjectsRoot?: string | undefined;
  resultFile?: ResultFile | undefined;
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

function resolvePublicNotePath(options: DiscordBriefingOptions): string | null {
  if (!options.notePath) {
    return null;
  }
  const env = {
    ...process.env,
    CO_OBSIDIAN_PROJECTS_ROOT:
      options.obsidianProjectsRoot ?? process.env["CO_OBSIDIAN_PROJECTS_ROOT"],
  };
  return toObsidianRelativePath(options.notePath, env);
}

function buildProgressLines(
  report: ReportRecord,
  options: DiscordBriefingOptions,
): string[] {
  if (options.resultFile) {
    return [
      report.snapshot,
      ...createPublicOutcomeLines(options.resultFile),
    ].filter((line) => line.trim() !== "");
  }
  return [report.snapshot, report.completed].filter(
    (line) => line.trim() !== "",
  );
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
  const notePath =
    publicStage === "진행" ? resolvePublicNotePath(options) : null;
  const bodyLines =
    publicStage === "접수"
      ? [createPublicRequestLead(requestText, phase), report.snapshot]
      : publicStage === "진행"
        ? [
            createPublicRequestLead(requestText, phase),
            ...buildProgressLines(report, options),
          ]
        : [
            createPublicRequestLead(requestText, phase),
            report.snapshot,
            report.completed,
          ];
  return joinLines([
    "---",
    `[${publicStage}] ${createPublicBriefingTitle(requestText, phase)}`,
    ...bodyLines,
    `다음: ${report.next}`,
    `담당: ${report.role} / ${report.tier}`,
    ...(notePath ? [`문서: ${notePath}`] : []),
  ]);
}

export function renderDiscordFinalMessage(input: {
  requestText: string;
  missionId: string;
  worker: string;
  tier: string;
  resultFile: ResultFile;
  nextStep: string;
  notePath: string;
  obsidianProjectsRoot?: string | undefined;
  summaryPath?: string | undefined;
  closeoutStatus: string;
}): string {
  const publicNotePath = toObsidianRelativePath(input.notePath, {
    ...process.env,
    CO_OBSIDIAN_PROJECTS_ROOT:
      input.obsidianProjectsRoot ?? process.env["CO_OBSIDIAN_PROJECTS_ROOT"],
  });
  return joinLines([
    "---",
    `[최종 결과] ${createPublicBriefingTitle(input.requestText, "final")}`,
    createPublicRequestLead(input.requestText, "final"),
    `결과: ${input.resultFile.result_summary}`,
    ...createPublicOutcomeLines(input.resultFile),
    `다음: ${input.nextStep}`,
    `담당: ${input.worker} / ${input.tier}`,
    `mission: ${input.missionId}`,
    ...(publicNotePath ? [`문서: ${publicNotePath}`] : []),
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
