import * as fs from "node:fs/promises";
import * as path from "node:path";

import type {
  CloseoutFile,
  Mission,
  MissionBacklogItem,
} from "../types/domain.js";
import { parseCloseoutFile, parseReportRecord } from "../types/domain.js";
import { appendEvent } from "./events.js";
import { missionArtifactDir, readMission, writeMission } from "./missions.js";
import { exists, readJson } from "./runtime.js";

const REQUIRED_HEADERS: Record<string, string[]> = {
  "STATUS.md": ["현재 상태", "이번 세션에서 완료한 것"],
  "NEXT-STEPS.md": ["다음 우선순위", "재개 순서"],
};

function assertPriorityCoverage(backlog: MissionBacklogItem[]): void {
  for (const item of backlog) {
    if (!["P0", "P1", "P2", "P3"].includes(item.priority)) {
      throw new Error(
        `Unclassified backlog item: ${item.id ?? item.title ?? "unknown"}`,
      );
    }
    if (["P0", "P1"].includes(item.priority) && item.status !== "done") {
      throw new Error(
        `Mission still has unresolved ${item.priority} backlog: ${item.title}`,
      );
    }
  }
}

async function requireFile(filePath: string): Promise<string> {
  if (!(await exists(filePath))) {
    throw new Error(`Required closeout file missing: ${filePath}`);
  }
  return fs.readFile(filePath, "utf8");
}

function assertHeaders(fileName: string, content: string): void {
  for (const header of REQUIRED_HEADERS[fileName] ?? []) {
    if (!content.includes(header)) {
      throw new Error(`${fileName} missing required header: ${header}`);
    }
  }
}

async function assertRequiredReports(
  root: string,
  mission: Mission,
): Promise<void> {
  for (const reportKey of mission.closeout?.required_reports ?? []) {
    const reportsDir = path.join(root, "runtime", "state", "reports");
    const files = (await fs.readdir(reportsDir)).filter((file) =>
      file.endsWith(".json"),
    );
    const match = [];
    for (const file of files) {
      const report = await readJson(
        path.join(reportsDir, file),
        parseReportRecord,
        null,
      );
      if (
        report?.mission_id === mission.mission_id &&
        report.report_key === reportKey
      ) {
        match.push(report);
      }
    }
    if (match.length === 0) {
      throw new Error(`Required report missing: ${reportKey}`);
    }
  }
}

export async function verifyMissionCloseout(
  root: string,
  missionId: string,
): Promise<{ status: "passed"; missionId: string; artifactDir: string }> {
  const mission = await readMission(root, missionId);
  if (!mission) {
    throw new Error(`Mission not found: ${missionId}`);
  }

  const artifactDir = missionArtifactDir(root, missionId);
  const statusContent = await requireFile(path.join(artifactDir, "STATUS.md"));
  const nextStepsContent = await requireFile(
    path.join(artifactDir, "NEXT-STEPS.md"),
  );
  const closeout: CloseoutFile | null = await readJson(
    path.join(artifactDir, "closeout.json"),
    parseCloseoutFile,
    null,
  );

  if (!closeout?.obsidian_note_ref) {
    throw new Error("closeout.json missing obsidian_note_ref");
  }

  assertHeaders("STATUS.md", statusContent);
  assertHeaders("NEXT-STEPS.md", nextStepsContent);
  assertPriorityCoverage(mission.backlog ?? []);
  await assertRequiredReports(root, mission);

  mission.closeout.status = "passed";
  mission.updated_at = new Date().toISOString();
  await writeMission(root, mission);
  await appendEvent(root, "closeout.passed", { mission_id: missionId });

  return {
    status: "passed",
    missionId,
    artifactDir,
  };
}
