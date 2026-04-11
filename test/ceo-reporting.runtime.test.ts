import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildRetryReviewReport,
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
