import type { Job, ReportRecord } from "../types/domain.js";
import { createRequestBrief } from "./ceo-reporting.js";
import { renderDiscordFollowUpBriefing } from "./discord-briefing.js";
import { listJobsForMission } from "./jobs.js";
import { listMissionReports } from "./reporting.js";
import { findActiveThreadMission } from "./thread-missions.js";

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

function describeFollowUpStatus(
  latestReport: ReportRecord | null,
  latestJob: Job | null,
): { stage: string; statusLine: string; detailLine: string; nextLine: string } {
  if (latestJob?.status === "failed") {
    return {
      stage: "진행 상태",
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
      stage: "진행 상태",
      statusLine:
        "현재 결과물은 확보됐고, 마감 문서 정리와 완료 조건 점검을 진행 중입니다.",
      detailLine: latestReport.completed,
      nextLine: latestReport.next,
    };
  }

  if (latestReport?.stage === "마감 점검") {
    return {
      stage: "진행 상태",
      statusLine:
        "현재 마감 가능 여부를 확인 중이며, 재시도 없이 끝낼지 추가 보완이 필요한지 판단하는 단계입니다.",
      detailLine: latestReport.completed,
      nextLine: latestReport.next,
    };
  }

  if (latestJob?.status === "running") {
    return {
      stage: "진행 상태",
      statusLine: `현재 ${latestJob.worker} / ${latestJob.tier}가 작업을 진행 중이며, 결과 확보 전 단계입니다.`,
      detailLine:
        latestReport?.completed ??
        "요청을 접수한 뒤 담당 작업을 시작할 수 있도록 준비했습니다.",
      nextLine:
        latestReport?.next ??
        "worker 실행 결과를 확인한 뒤 다음 진행 상황을 보고드립니다.",
    };
  }

  if (latestReport) {
    return {
      stage: "진행 상태",
      statusLine: `현재 ${latestReport.stage} 단계까지 진행됐고, 최신 상태를 기준으로 작업 흐름을 이어가고 있습니다.`,
      detailLine: latestReport.completed,
      nextLine: latestReport.next,
    };
  }

  return {
    stage: "진행 상태",
    statusLine:
      "현재 요청은 접수된 상태이며, 담당 배정과 실행 준비를 계속 진행하고 있습니다.",
    detailLine:
      "아직 사용자에게 공유된 진행 보고는 없지만, 작업 상태를 내부에서 확인 중입니다.",
    nextLine: "담당 배정과 첫 진행 보고를 이어서 정리합니다.",
  };
}

export async function buildFollowUpReply(
  root: string,
  chatId: string,
): Promise<{ missionId: string; content: string } | null> {
  const mission = await findActiveThreadMission(root, chatId);
  if (!mission) {
    return null;
  }

  const [reports, jobs] = await Promise.all([
    listMissionReports(root, mission.mission_id),
    listJobsForMission(root, mission.mission_id),
  ]);
  const latestReport = pickLatestReport(reports);
  const latestJob = pickLatestJob(jobs);
  const status = describeFollowUpStatus(latestReport, latestJob);
  const requestBrief =
    latestReport?.request_brief ?? createRequestBrief(mission.user_request);

  return {
    missionId: mission.mission_id,
    content: renderDiscordFollowUpBriefing({
      requestBrief,
      stage: status.stage,
      statusLine: status.statusLine,
      detailLine: status.detailLine,
      nextLine: status.nextLine,
      role: "ceo",
      tier: "standard",
    }),
  };
}
