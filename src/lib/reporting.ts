import type { ReportInput, ReportRecord } from "../types/domain.js";
import { parseReportRecord } from "../types/domain.js";
import { appendEvent } from "./events.js";
import { hashValue, openExclusive, readJson, runtimePath } from "./runtime.js";

function renderReport(input: ReportInput): string {
  const lines = [
    `한눈요약: ${input.snapshot}`,
    `요청 요지: ${input.requestSummary}`,
    `현재 단계: ${input.stage}`,
    `방금 진행한 내용: ${input.completed}`,
    `단계 전환 이유: ${input.transitionReason}`,
    `다음 조치: ${input.next}`,
    `담당: ${input.role} / ${input.tier}`,
  ];
  if (input.evidence) {
    lines.push(`확인 근거: ${input.evidence}`);
  }
  return lines.join("\n");
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
    const findings = input.findings ?? input.evidence ?? input.transitionReason;
    const report: ReportRecord = {
      reportId: `report-${hash.slice(0, 12)}`,
      mission_id: input.missionId,
      report_key: input.reportKey,
      stage: input.stage,
      role: input.role,
      tier: input.tier,
      request_summary: input.requestSummary,
      snapshot: input.snapshot,
      completed: input.completed,
      transition_reason: input.transitionReason,
      findings,
      next: input.next,
      evidence: input.evidence ?? null,
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
