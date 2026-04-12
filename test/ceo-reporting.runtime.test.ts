import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildHandoffCompletedReport,
  buildRetryReviewReport,
  createPublicBriefingTitle,
  createRequestBrief,
  createRequestSummary,
} from "../src/lib/ceo-reporting.js";

test("createRequestBrief keeps the request header short and readable", () => {
  const brief = createRequestBrief(
    "보고 메시지 형식 테스트입니다. 한눈요약과 단계 전환 이유가 자연스럽게 보이도록 바꿔줘",
  );
  assert.equal(brief.length <= 28, true);
  assert.match(brief, /보고 메시지 형식 테스트/);
});

test("createRequestSummary keeps target and purpose in one reusable sentence", () => {
  const summary = createRequestSummary(
    "로그인 이슈를 조사해서 원인과 다음 조치를 정리해줘",
  );
  assert.match(summary, /로그인 이슈/);
  assert.match(summary, /정리/);
  assert.equal(summary.length <= 80, true);
});

test("createPublicBriefingTitle derives a non-truncated stage title from the request subject", () => {
  const title = createPublicBriefingTitle(
    "간단한 투두앱을 실제 구현으로 진행해줘. 최소 기능은 추가, 완료 토글, 삭제야.",
    "progress",
  );

  assert.equal(title, "간단한 투두앱 진행 결과");
  assert.doesNotMatch(title, /…/);
});

test("handoff completed report reflects actual deliverables instead of summary path jargon", () => {
  const report = buildHandoffCompletedReport(
    "간단한 투두앱 실제 구현 건의 결과와 후속 조치를 정리하는 작업입니다.",
    {
      outcome_kind: "code_change",
      result_summary:
        "투두앱 기본 기능 1차 구현을 마쳤습니다. 실행 가능한 화면과 저장 흐름을 정리했습니다.",
      completed_items: [
        "할 일 추가",
        "완료 토글",
        "삭제",
        "전체/진행 중/완료 필터",
        "localStorage 저장",
      ],
      remaining_work: ["테스트 보강과 후속 기능 우선순위 정리"],
      risks: [],
      deliverable_refs: ["/tmp/IMPLEMENTATION.md"],
      workspace_ref: "/tmp/todo-app",
      changed_paths: ["src/App.tsx"],
      verification: ["npm test"],
      follow_up_tasks: ["테스트 보강"],
    },
  );

  assert.equal(report.stage, "결과 확보");
  assert.match(report.snapshot, /투두앱 기본 기능 1차 구현/);
  assert.match(report.completed, /할 일 추가/);
  assert.doesNotMatch(report.completed, /localStorage 저장/);
  assert.match(report.completed, /검증 항목은 npm test까지 점검했습니다/);
  assert.doesNotMatch(report.snapshot, /summary\.md/);
  assert.doesNotMatch(report.completed, /summary\.md/);
  assert.match(report.next, /테스트 보강/);
});

test("retry review templates distinguish no-retry and retry-required paths", () => {
  const requestSummary =
    "로그인 이슈를 조사하고 결과와 다음 조치를 정리하는 작업입니다.";
  const noRetry = buildRetryReviewReport({
    requestSummary,
    retryRequired: false,
  });
  const retryRequired = buildRetryReviewReport({
    requestSummary,
    retryRequired: true,
    retryReason: "필수 검증 근거가 아직 부족합니다.",
    nextAssignee: "researcher / standard",
  });

  assert.equal(noRetry.stage, "마감 점검");
  assert.match(noRetry.snapshot, /추가 실행 없이 마감 가능한 상태/);
  assert.match(noRetry.transitionReason, /추가 재시도 없이 closeout 검증/);
  assert.equal(noRetry.evidence, "재시도 없음");

  assert.equal(retryRequired.stage, "마감 점검");
  assert.match(retryRequired.snapshot, /재시도 단계로 다시 보냅니다/);
  assert.match(
    retryRequired.transitionReason,
    /필수 검증 근거가 아직 부족합니다/,
  );
  assert.match(retryRequired.next, /researcher \/ standard 재실행/);
  assert.equal(retryRequired.evidence, "필수 검증 근거가 아직 부족합니다.");
});
