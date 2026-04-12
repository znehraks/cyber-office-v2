import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
  renderDiscordFinalMessage,
  renderDiscordReportBriefing,
} from "../src/lib/discord-briefing.js";
import type { ReportRecord } from "../src/types/domain.js";

function makeReport(overrides: Partial<ReportRecord> = {}): ReportRecord {
  return {
    reportId: "report-1",
    mission_id: "mission-1",
    report_key: "job.routed",
    stage: "담당 배정",
    role: "ceo",
    tier: "standard",
    request_brief: "간단한 투두앱",
    request_summary:
      "간단한 투두앱 실제 구현 건을 처리하고 결과를 정리하는 작업입니다.",
    snapshot:
      "간단한 투두앱 구현 요청을 실행 가능한 작업으로 정리했고 담당 배정까지 마쳤습니다.",
    completed:
      "app-dev / standard 담당에 작업 범위와 입력 자료를 넘겨 바로 구현을 시작할 수 있게 했습니다.",
    transition_reason:
      "작업 경계와 입력 자료가 정리돼 바로 구현에 착수할 수 있습니다.",
    findings: "작업 경계와 입력 자료가 정리돼 바로 구현에 착수할 수 있습니다.",
    next: "app-dev / standard가 기본 기능 구현을 진행합니다.",
    evidence: null,
    content: "",
    duplicate: false,
    ...overrides,
  };
}

test("public discord briefing collapses internal reports into intake and progress only", () => {
  const intake = renderDiscordReportBriefing(makeReport(), {
    requestText:
      "간단한 투두앱을 실제 구현으로 진행해줘. 최소 기능은 추가, 완료 토글, 삭제야.",
  });
  assert.ok(intake);
  assert.match(intake, /^---$/m);
  assert.match(intake, /^\[접수] 간단한 투두앱 착수$/m);
  assert.match(intake, /요청하신 간단한 투두앱.*구현/);
  assert.doesNotMatch(intake, /현재 단계:|단계 전환 이유:|한눈요약:/);
  assert.doesNotMatch(intake, /…/);

  const missionCreated = renderDiscordReportBriefing(
    makeReport({
      report_key: "mission.created",
      stage: "요청 검토",
    }),
    {
      requestText:
        "간단한 투두앱을 실제 구현으로 진행해줘. 최소 기능은 추가, 완료 토글, 삭제야.",
    },
  );
  assert.equal(missionCreated, null);
});

test("public progress and final messages prioritize actual result and hide summary path", () => {
  const progress = renderDiscordReportBriefing(
    makeReport({
      report_key: "handoff.completed",
      stage: "결과 확보",
      snapshot:
        "투두앱 기본 기능 1차 구현을 마쳤고, 이번 mission에서 확인한 결과를 바로 정리할 수 있습니다.",
      completed:
        "할 일 추가, 완료 토글, 삭제, 전체/진행 중/완료 필터, localStorage 저장까지 반영했습니다.",
      next: "테스트 보강과 후속 기능 우선순위를 정리합니다.",
      evidence: "/tmp/summary.md",
    }),
    {
      requestText:
        "간단한 투두앱을 실제 구현으로 진행해줘. 최소 기능은 추가, 완료 토글, 삭제야.",
    },
  );
  assert.ok(progress);
  assert.match(progress, /^\[진행] 간단한 투두앱 진행 결과$/m);
  assert.match(progress, /할 일 추가, 완료 토글, 삭제/);
  assert.doesNotMatch(progress, /summary\.md|\/tmp\/summary\.md/);

  const noRetry = renderDiscordReportBriefing(
    makeReport({
      report_key: "job.retried",
      stage: "마감 점검",
      evidence: "재시도 없음",
    }),
    {
      requestText:
        "간단한 투두앱을 실제 구현으로 진행해줘. 최소 기능은 추가, 완료 토글, 삭제야.",
    },
  );
  assert.equal(noRetry, null);

  const finalMessage = renderDiscordFinalMessage({
    requestText:
      "간단한 투두앱을 실제 구현으로 진행해줘. 최소 기능은 추가, 완료 토글, 삭제야.",
    missionId: "mission-1",
    worker: "app-dev",
    tier: "standard",
    resultSummary: "투두앱 기본 기능 1차 구현을 마쳤습니다.",
    nextStep: "테스트 보강과 후속 기능 우선순위를 정리합니다.",
    notePath: "/notes/todo.md",
    summaryPath: "/tmp/summary.md",
    closeoutStatus: "passed",
  });
  assert.match(finalMessage, /^\[최종 결과] 간단한 투두앱 최종 결과$/m);
  assert.match(
    finalMessage,
    /^결과: 투두앱 기본 기능 1차 구현을 마쳤습니다\.$/m,
  );
  assert.match(finalMessage, /^note: \/notes\/todo\.md$/m);
  assert.doesNotMatch(finalMessage, /^summary: /m);
});
