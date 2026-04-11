import * as path from "node:path";

import type { ReportInput, ReportRecord } from "../types/domain.js";
import { parseReportRecord } from "../types/domain.js";
import { appendEvent } from "./events.js";
import { hashValue, openExclusive, readJson, runtimePath } from "./runtime.js";

function buildLead(input: ReportInput): string {
  if (input.stage === "최종 완료") {
    return "작업이 잘 마무리되어 결과를 정리해드릴게요.";
  }
  if (input.stage === "요청 접수") {
    return "요청 잘 받았습니다. 진행 상황을 바로 공유드릴게요.";
  }
  return "진행 상황을 이어서 공유드릴게요.";
}

function renderReport(input: ReportInput): string {
  return [
    buildLead(input),
    "",
    `현재 단계: ${input.stage}`,
    `role / tier: ${input.role} / ${input.tier}`,
    `방금 한 일: ${input.completed}`,
    `발견: ${input.findings}`,
    `다음 일: ${input.next}`,
  ].join("\n");
}

export async function recordReport(
  root: string,
  input: ReportInput,
): Promise<ReportRecord> {
  const dedupeKey = `${input.missionId}:${input.reportKey}`;
  const hash = hashValue(dedupeKey);
  const reportPath = runtimePath(root, "state", "reports", `${hash}.json`);

  try {
    const handle = await openExclusive(reportPath);
    const report: ReportRecord = {
      reportId: `report-${hash.slice(0, 12)}`,
      mission_id: input.missionId,
      report_key: input.reportKey,
      stage: input.stage,
      role: input.role,
      tier: input.tier,
      completed: input.completed,
      findings: input.findings,
      next: input.next,
      content: renderReport(input),
      duplicate: false,
    };
    await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, "utf8");
    await handle.close();

    await appendEvent(
      root,
      "report.sent",
      {
        mission_id: input.missionId,
        report_id: report.reportId,
        stage: input.stage,
        role: input.role,
        tier: input.tier,
      },
      { idempotencyKey: dedupeKey },
    );

    return report;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "EEXIST"
    ) {
      throw error;
    }

    const existing = await readJson(reportPath, parseReportRecord);
    return { ...existing, duplicate: true };
  }
}
