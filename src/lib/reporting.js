import path from "node:path";

import { appendEvent } from "./events.js";
import { hashValue, openExclusive, readJson, runtimePath } from "./runtime.js";

function renderReport(input) {
  return [
    `현재 단계: ${input.stage}`,
    `role / tier: ${input.role} / ${input.tier}`,
    `방금 한 일: ${input.completed}`,
    `발견: ${input.findings}`,
    `다음 일: ${input.next}`,
  ].join("\n");
}

export async function recordReport(root, input) {
  const dedupeKey = `${input.missionId}:${input.reportKey}`;
  const hash = hashValue(dedupeKey);
  const reportPath = runtimePath(root, "state", "reports", `${hash}.json`);

  try {
    const handle = await openExclusive(reportPath);
    const report = {
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
    if (!error || error.code !== "EEXIST") {
      throw error;
    }

    const existing = await readJson(reportPath);
    return { ...existing, duplicate: true };
  }
}
