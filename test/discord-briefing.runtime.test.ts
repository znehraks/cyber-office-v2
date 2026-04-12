import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
  renderDiscordFinalMessage,
  renderDiscordReportBriefing,
} from "../src/lib/discord-briefing.js";
import type { ReportRecord, ResultFile } from "../src/types/domain.js";

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

function makeCodeChangeResult(): ResultFile {
  return {
    outcome_kind: "code_change",
    result_summary:
      "투두앱 기본 기능 1차 구현을 마쳤고, 바로 이어서 마감 정리를 진행할 수 있습니다.",
    completed_items: [
      "할 일 추가",
      "완료 토글",
      "삭제",
      "전체/진행 중/완료 필터",
      "드래그 정렬",
    ],
    remaining_work: ["테스트 보강과 후속 기능 우선순위 정리"],
    risks: [],
    deliverable_refs: ["/tmp/IMPLEMENTATION.md"],
    workspace_ref: "/workspace/todo-app",
    changed_paths: ["src/App.tsx", "src/components/TodoList.tsx"],
    verification: ["npm test", "npm run lint"],
    follow_up_tasks: ["테스트 보강"],
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
      notePath:
        "/obsidian/todo-app-e2e/_cyber-office/epics/todo-app/missions/mission-1.md",
      obsidianProjectsRoot: "/obsidian",
      resultFile: makeCodeChangeResult(),
    },
  );
  assert.ok(progress);
  assert.match(progress, /^\[진행] 간단한 투두앱 진행 결과$/m);
  assert.match(progress, /할 일 추가, 완료 토글, 삭제/);
  assert.match(progress, /src\/App\.tsx/);
  assert.match(progress, /npm test/);
  assert.match(progress, /완료한 항목은 .*반영했습니다\./);
  assert.match(progress, /검증 항목은 .*점검했습니다\./);
  assert.doesNotMatch(progress, /드래그 정렬/);
  assert.doesNotMatch(progress, /까지까지|까지이고|등을이고|등을까지/);
  assert.match(
    progress,
    /^문서: todo-app-e2e\/_cyber-office\/epics\/todo-app\/missions\/mission-1\.md$/m,
  );
  assert.doesNotMatch(progress, /summary\.md|\/tmp\/summary\.md/);
  assert.doesNotMatch(progress, /\/obsidian\//);

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
    resultFile: makeCodeChangeResult(),
    nextStep: "테스트 보강과 후속 기능 우선순위를 정리합니다.",
    notePath:
      "/obsidian/todo-app-e2e/_cyber-office/epics/todo-app/missions/mission-1.md",
    obsidianProjectsRoot: "/obsidian",
    summaryPath: "/tmp/summary.md",
    closeoutStatus: "passed",
  });
  assert.match(finalMessage, /^\[최종 결과] 간단한 투두앱 최종 결과$/m);
  assert.match(finalMessage, /src\/App\.tsx/);
  assert.match(finalMessage, /npm run lint/);
  assert.match(finalMessage, /완료한 항목은 .*반영했습니다\./);
  assert.match(finalMessage, /검증 항목은 .*점검했습니다\./);
  assert.doesNotMatch(finalMessage, /드래그 정렬/);
  assert.doesNotMatch(finalMessage, /까지까지|까지이고|등을이고|등을까지/);
  assert.match(
    finalMessage,
    /^문서: todo-app-e2e\/_cyber-office\/epics\/todo-app\/missions\/mission-1\.md$/m,
  );
  assert.match(finalMessage, /^담당: app-dev \/ standard$/m);
  assert.doesNotMatch(finalMessage, /^summary: /m);
  assert.doesNotMatch(finalMessage, /\/obsidian\//);
});

test("public research progress briefing exposes actual findings without looking like a log", () => {
  const progress = renderDiscordReportBriefing(
    makeReport({
      report_key: "handoff.completed",
      stage: "결과 확보",
      snapshot:
        "로그인 실패 원인을 정리했고, 이번 mission에서 확인한 핵심 근거를 기준으로 후속 조치를 이어갈 수 있습니다.",
      completed:
        "Discord 토큰 미설정, Claude CLI 미인증, doctor 사전 감지 공백까지 확인했습니다.",
      next: "실제 환경에서 토큰 주입과 인증 상태를 다시 점검합니다.",
    }),
    {
      requestText: "로그인 이슈를 조사해줘",
      notePath:
        "/obsidian/todo-app-e2e/_cyber-office/epics/login-issue/missions/mission-2.md",
      obsidianProjectsRoot: "/obsidian",
      resultFile: {
        outcome_kind: "research_brief",
        result_summary:
          "로그인 실패 원인을 서비스 설정과 실행 경로 기준으로 1차 정리했습니다.",
        completed_items: ["원인 분류", "우선순위 정리"],
        remaining_work: ["실제 운영 환경 재확인"],
        risks: [],
        deliverable_refs: ["/tmp/RESEARCH.md"],
        key_findings: [
          "Discord 토큰이 없으면 시작 단계에서 즉시 실패합니다.",
          "Claude 인증이 없으면 worker가 non-zero exit로 종료됩니다.",
          "doctor는 현재 두 오류를 사전 감지하지 못합니다.",
        ],
        recommended_next_steps: ["운영 환경 재점검"],
      },
    },
  );

  assert.ok(progress);
  assert.match(
    progress,
    /핵심 확인 사항은 Discord 토큰이 없으면 시작 단계에서 즉시 실패합니다/,
  );
  assert.match(
    progress,
    /^문서: todo-app-e2e\/_cyber-office\/epics\/login-issue\/missions\/mission-2\.md$/m,
  );
  assert.doesNotMatch(
    progress,
    /현재 단계:|단계 전환 이유:|summary\.md|closeout 검증/,
  );
});
