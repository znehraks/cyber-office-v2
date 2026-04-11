import type {
  ReportInput,
  RoutingCategory,
  RoutingDecision,
} from "../types/domain.js";

export interface CeoStageReport
  extends Pick<
    ReportInput,
    | "stage"
    | "requestSummary"
    | "snapshot"
    | "completed"
    | "transitionReason"
    | "next"
    | "evidence"
  > {}

const CATEGORY_LABELS: Record<RoutingCategory, string> = {
  quick: "신속 처리 건",
  research: "조사 중심 건",
  standard: "일반 실행 건",
  architecture: "설계 중심 건",
  critique: "리스크 검토 건",
  visual: "디자인 중심 건",
  "visual-high": "고난도 디자인 검토 건",
  "high-risk": "고위험 검토 건",
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function describeCategory(category: RoutingCategory): string {
  return CATEGORY_LABELS[category];
}

export function createRequestBrief(request: string): string {
  const normalized = normalizeWhitespace(request);
  if (normalized === "") {
    return "요청 처리";
  }

  return truncateText(normalized, 28);
}

export function createRequestSummary(request: string): string {
  const normalized = normalizeWhitespace(request);
  if (normalized === "") {
    return "요청 내용을 검토해 담당 배정부터 결과 마감까지 정리하는 작업입니다.";
  }

  const primary = `요청하신 "${truncateText(normalized, 34)}" 건의 처리 경로와 결과를 정리하는 작업입니다.`;
  if (primary.length >= 40 && primary.length <= 80) {
    return primary;
  }

  const compact = `요청하신 "${truncateText(normalized, 42)}" 건을 처리하고 결과를 정리하는 작업입니다.`;
  if (compact.length <= 80) {
    return compact;
  }

  return `요청하신 "${truncateText(normalized, 48)}" 건의 진행과 결과를 정리하는 작업입니다.`;
}

export function buildMissionCreatedReport(
  requestSummary: string,
  routing: RoutingDecision,
): CeoStageReport {
  return {
    stage: "요청 검토",
    requestSummary,
    snapshot: `요청을 ${describeCategory(routing.category)}으로 판단했습니다. 실행 유형과 담당 기준이 정리돼 배정 단계로 넘어갑니다.`,
    completed:
      "요청 내용을 실행 가능한 작업으로 정리하고 mission을 등록했습니다.",
    transitionReason:
      "실행 유형과 담당 판단이 끝났기 때문에 바로 담당 배정 단계로 이어질 수 있습니다.",
    next: `${routing.worker} / ${routing.tier} 담당 기준으로 작업 범위와 책임을 확정합니다.`,
    evidence: null,
  };
}

export function buildJobRoutedReport(
  requestSummary: string,
  routing: RoutingDecision,
  packetPath: string,
): CeoStageReport {
  return {
    stage: "담당 배정",
    requestSummary,
    snapshot: `${routing.worker} / ${routing.tier} 담당을 확정했습니다. 입력 자료와 작업 경계가 정리돼 바로 작업을 시작할 수 있습니다.`,
    completed: `${routing.worker} / ${routing.tier} 담당에 작업 packet을 전달하고 착수 조건을 맞췄습니다.`,
    transitionReason:
      "입력 자료와 작업 경계가 정리돼 worker가 별도 확인 없이 바로 실행할 수 있습니다.",
    next: `${routing.worker} / ${routing.tier}가 작업을 수행하고 결과 산출물을 작성합니다.`,
    evidence: packetPath,
  };
}

export function buildHandoffCompletedReport(
  requestSummary: string,
  summaryPath: string,
): CeoStageReport {
  return {
    stage: "결과 확보",
    requestSummary,
    snapshot:
      "필수 산출물인 summary.md를 확보했습니다. 결과 정리가 가능해 마감 문서 작성 단계로 넘어갑니다.",
    completed:
      "worker가 남긴 summary.md를 수집해 결과 정리를 시작할 수 있게 했습니다.",
    transitionReason:
      "summary.md가 생성돼 이번 작업의 결과와 후속 조치를 closeout 문서에 정리할 수 있습니다.",
    next: "closeout 문서를 작성하고 완료 조건을 점검합니다.",
    evidence: summaryPath,
  };
}

export function buildRetryReviewReport(options: {
  requestSummary: string;
  retryRequired: boolean;
  retryReason?: string | undefined;
  nextAssignee?: string | undefined;
}): CeoStageReport {
  if (options.retryRequired) {
    const retryReason =
      options.retryReason ??
      "필수 산출물이나 검증 근거가 아직 충분하지 않습니다.";
    const nextAssignee = options.nextAssignee ?? "담당 worker";
    return {
      stage: "마감 점검",
      requestSummary: options.requestSummary,
      snapshot:
        "현재 결과만으로는 마감 근거가 부족합니다. 누락 사항을 보완하기 위해 재시도 단계로 다시 보냅니다.",
      completed:
        "마감 가능 여부를 검토한 결과, 보완 재시도가 필요하다고 판단했습니다.",
      transitionReason: `${retryReason} 추가 실행을 거쳐야 안전하게 마감할 수 있습니다.`,
      next: `${nextAssignee} 재실행을 준비하고 보완 결과를 다시 확인합니다.`,
      evidence: retryReason,
    };
  }

  return {
    stage: "마감 점검",
    requestSummary: options.requestSummary,
    snapshot:
      "재시도 필요 여부를 점검했고 추가 실행 없이 마감 가능한 상태입니다. 현재 결과로 closeout 검증을 진행합니다.",
    completed:
      "재시도 필요 여부를 확인했고 이번 요청은 정상 경로로 마감하기로 판단했습니다.",
    transitionReason:
      "필수 산출물과 진행 이력이 충분해 추가 재시도 없이 closeout 검증으로 넘어갈 수 있습니다.",
    next: "closeout 조건을 확인하고 최종 마감을 준비합니다.",
    evidence: "재시도 없음",
  };
}

export function buildMissionCompletedReport(
  requestSummary: string,
): CeoStageReport {
  return {
    stage: "최종 마감",
    requestSummary,
    snapshot:
      "마감 문서를 정리했고 완료 확정 직전 상태입니다. closeout 검증 조건이 충족돼 최종 완료를 확정할 수 있습니다.",
    completed:
      "closeout 문서를 작성하고 최종 검증에 필요한 항목을 모두 맞췄습니다.",
    transitionReason:
      "필수 문서와 보고, backlog 조건이 정리돼 closeout 검증만 통과하면 mission 완료를 확정할 수 있습니다.",
    next: "closeout 검증을 마치고 mission 완료를 확정합니다.",
    evidence: "closeout 문서 준비 완료",
  };
}
