import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { Mission, ResultFile } from "../types/domain.js";
import { listMissionsForEpic, missionArtifactDir } from "./missions.js";
import {
  epicNotePath,
  missionDeliverablePath,
  missionNotePath,
} from "./projects.js";

function firstMeaningfulSummaryLine(summaryBody: string): string {
  const lines = summaryBody
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  return lines[0] ?? "summary 산출물을 확보했습니다.";
}

function renderSection(title: string, lines: string[]): string {
  const normalized = lines.length > 0 ? lines : ["- 없음"];
  return [`## ${title}`, "", ...normalized].join("\n");
}

function missionStatusLabel(mission: Mission): string {
  return mission.closeout.status === "passed" ? "종료" : "진행 중";
}

export async function writeEpicOverviewNote(
  root: string,
  mission: Mission,
): Promise<string> {
  const notePath = epicNotePath(mission.project_ref, mission.epic_ref.slug);
  const missions = await listMissionsForEpic(root, mission.epic_ref.epic_id);
  const epicGoal = missions[0]?.user_request ?? mission.user_request;
  const openMissions = missions
    .filter((entry) => entry.closeout.status !== "passed")
    .map((entry) => `- ${entry.mission_id}: ${entry.user_request}`);
  const closedMissions = missions
    .filter((entry) => entry.closeout.status === "passed")
    .map((entry) => `- ${entry.mission_id}: ${entry.user_request}`);

  const lines = [
    `# ${mission.epic_ref.title}`,
    "",
    renderSection("epic 목표", [`- ${epicGoal}`]),
    "",
    renderSection("현재 상태", [
      `- epic status: ${mission.epic_ref.status}`,
      `- active mission: ${mission.epic_ref.active_mission_id ?? "없음"}`,
    ]),
    "",
    renderSection("주요 결정", [
      `- project: ${mission.project_ref.display_name}`,
      `- epic thread: ${mission.epic_ref.discord_thread_id}`,
    ]),
    "",
    renderSection("열린 mission / 종료 mission 목록", [
      ...openMissions,
      ...closedMissions,
    ]),
    "",
    renderSection("다음 큰 단계", [
      mission.closeout.status === "passed"
        ? "- 다음 요청 또는 후속 epic을 준비합니다."
        : "- 현재 active mission의 결과와 closeout을 계속 정리합니다.",
    ]),
    "",
  ];

  await fs.mkdir(path.dirname(notePath), { recursive: true });
  await fs.writeFile(notePath, `${lines.join("\n")}\n`, "utf8");
  return notePath;
}

export async function writeMissionCanonicalNote(
  root: string,
  mission: Mission,
  options: {
    summaryBody?: string | undefined;
    result?: ResultFile | undefined;
    completedItems?: string[] | undefined;
    nextSteps?: string[] | undefined;
    risks?: string[] | undefined;
    deliverableName?: string | undefined;
  } = {},
): Promise<string> {
  const notePath = missionNotePath(
    mission.project_ref,
    mission.epic_ref.slug,
    mission.mission_id,
  );
  const epicPath = epicNotePath(mission.project_ref, mission.epic_ref.slug);
  const fallbackSummary =
    options.summaryBody && options.summaryBody.trim() !== ""
      ? firstMeaningfulSummaryLine(options.summaryBody)
      : "진행 중이며 결과 산출물을 준비하는 단계입니다.";
  const resultSummary = options.result?.result_summary ?? fallbackSummary;
  const completedItems = options.completedItems ?? [
    "- mission을 등록하고 실행 흐름을 시작했습니다.",
  ];
  const nextSteps = options.nextSteps ??
    options.result?.remaining_work.map((item) => `- ${item}`) ?? [
      "- worker 결과를 수집하고 closeout 문서를 정리합니다.",
    ];
  const risks = options.risks ??
    options.result?.risks.map((item) => `- ${item}`) ?? [
      "- 현재 확인된 특이 리스크는 없습니다.",
    ];
  const deliverableRef = options.deliverableName
    ? missionDeliverablePath(
        mission.project_ref,
        mission.epic_ref.slug,
        mission.mission_id,
        options.deliverableName,
      )
    : null;

  const lines = [
    `# ${mission.mission_id}`,
    "",
    renderSection("요청 요약", [`- ${mission.user_request}`]),
    "",
    renderSection("실제로 만든 것 또는 바뀐 것", [`- ${resultSummary}`]),
    "",
    renderSection("완료 항목", completedItems),
    "",
    renderSection("남은 일", nextSteps),
    "",
    renderSection("리스크", risks),
    "",
    renderSection("핵심 이벤트 타임라인", [
      `- ${mission.created_at}: mission 생성`,
      `- ${mission.updated_at}: 현재 상태 ${missionStatusLabel(mission)}`,
    ]),
    "",
    renderSection("오류/재시도 이력", ["- 현재 기록된 오류/재시도 없음"]),
    "",
    renderSection("Discord epic thread ref", [
      `- ${mission.epic_ref.discord_thread_id}`,
    ]),
    "",
    renderSection("runtime artifact ref", [
      `- ${missionArtifactDir(root, mission.mission_id)}`,
    ]),
    "",
    ...(deliverableRef
      ? [
          renderSection("canonical deliverable ref", [`- ${deliverableRef}`]),
          "",
        ]
      : []),
    renderSection("Epic note ref", [`- ${epicPath}`]),
    "",
  ];

  await fs.mkdir(path.dirname(notePath), { recursive: true });
  await fs.writeFile(notePath, `${lines.join("\n")}\n`, "utf8");
  return notePath;
}
