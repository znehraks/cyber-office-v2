import type {
  ReportInput,
  ResultFile,
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

export type PublicBriefingPhase =
  | "intake"
  | "progress"
  | "retry"
  | "final"
  | "status";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function withPeriod(value: string): string {
  const normalized = normalizeWhitespace(value);
  if (normalized === "") {
    return "";
  }
  return /[.!?]$/u.test(normalized) ? normalized : `${normalized}.`;
}

function stripControlTokens(value: string): string {
  return normalizeWhitespace(
    value
      .replace(/\[\[co:[^[\]]+\]\]/giu, " ")
      .replace(/^after-this:\s*/iu, " ")
      .replace(/^epic:\s*[^\n]+\s*/iu, " "),
  );
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

function firstSentence(value: string): string {
  const normalized = stripControlTokens(value);
  if (normalized === "") {
    return "";
  }
  const [line = ""] = normalized.split(/\n+/u, 1);
  const [sentence = line] = line.split(/[.!?]\s*/u, 1);
  return normalizeWhitespace(sentence);
}

function stripRequestEnding(value: string): string {
  return normalizeWhitespace(
    value.replace(
      /(해줘|해주세요|해 줘|부탁해|부탁합니다|가능할까|진행해줘|진행해주세요|정리해줘|검토해줘|조사해줘|만들어줘|구현해줘)$/u,
      "",
    ),
  );
}

function deriveRequestSubject(request: string): string {
  const sentence = stripRequestEnding(firstSentence(request));
  if (sentence === "") {
    return "요청 작업";
  }

  const objectMatch = sentence.match(
    /^(.+?)(?:을|를|에 대한|관련)?\s+(?:실제\s+|기본\s+|1차\s+|초기\s+)?(?:구현|개발|작성|정리|조사|검토|설계|수정|개선|분석|제작|생성|구축|도입|최적화|리팩터링)/u,
  );
  if (objectMatch?.[1]) {
    return normalizeWhitespace(objectMatch[1]);
  }

  const trimmed = sentence.replace(/["'`]/gu, "").trim();
  const withoutParticle = normalizeWhitespace(
    trimmed.replace(/(을|를|은|는|이|가)$/u, ""),
  );
  if (withoutParticle !== "" && withoutParticle.length <= 18) {
    return withoutParticle;
  }
  if (trimmed.length <= 18) {
    return trimmed;
  }
  return normalizeWhitespace(withoutParticle.slice(0, 18));
}

function deriveActionLabel(request: string): string {
  const cleaned = stripControlTokens(request);
  if (/(구현|개발|만들|수정|개선|리팩터링|fix)/iu.test(cleaned)) {
    return "구현";
  }
  if (/(조사|분석|리서치|검토|점검)/iu.test(cleaned)) {
    return "검토";
  }
  if (/(작성|정리|문서|카피)/iu.test(cleaned)) {
    return "작성";
  }
  if (/(설계|기획|플랜)/iu.test(cleaned)) {
    return "설계";
  }
  if (/(디자인|ui|ux)/iu.test(cleaned)) {
    return "디자인";
  }
  return "진행";
}

function summarizeItems(
  items: string[],
  maxItems: number,
): { text: string; truncated: boolean } {
  const filtered = items
    .map((item) => normalizeWhitespace(item))
    .filter(Boolean);
  if (filtered.length === 0) {
    return { text: "", truncated: false };
  }
  const visible = filtered.slice(0, maxItems);
  return {
    text: visible.join(", "),
    truncated: filtered.length > maxItems,
  };
}

function createCompletedItemsSentence(result: ResultFile): string {
  const completed = summarizeItems(result.completed_items, 5);
  if (completed.text === "") {
    return "이번 단계의 핵심 결과를 정리했습니다.";
  }
  return completed.truncated
    ? `완료한 항목은 ${completed.text} 등을 반영했습니다.`
    : `완료한 항목은 ${completed.text}까지 반영했습니다.`;
}

export function createPublicOutcomeDetail(result: ResultFile): string {
  switch (result.outcome_kind) {
    case "research_brief": {
      const findings = summarizeItems(result.key_findings ?? [], 2);
      if (findings.text === "") {
        return "";
      }
      return findings.truncated
        ? `핵심 확인 사항은 ${findings.text} 등입니다.`
        : `핵심 확인 사항은 ${findings.text}입니다.`;
    }
    case "plan_package": {
      const documents = summarizeItems(result.documents_created ?? [], 3);
      if (documents.text === "") {
        return "";
      }
      return documents.truncated
        ? `이번에 정리한 문서는 ${documents.text} 등입니다.`
        : `이번에 정리한 문서는 ${documents.text}입니다.`;
    }
    case "design_package": {
      const decisions = summarizeItems(result.design_decisions ?? [], 3);
      if (decisions.text === "") {
        return "";
      }
      return decisions.truncated
        ? `이번에 확정한 디자인 방향은 ${decisions.text} 등입니다.`
        : `이번에 확정한 디자인 방향은 ${decisions.text}입니다.`;
    }
    case "code_change": {
      const changed = summarizeItems(result.changed_paths ?? [], 4);
      const verification = summarizeItems(result.verification ?? [], 2);
      if (changed.text !== "" && verification.text !== "") {
        const changedLine = changed.truncated
          ? `변경한 영역은 ${changed.text} 등입니다.`
          : `변경한 영역은 ${changed.text}입니다.`;
        const verificationLine = verification.truncated
          ? `검증 항목은 ${verification.text} 등을 점검했습니다.`
          : `검증 항목은 ${verification.text}까지 점검했습니다.`;
        return `${changedLine} ${verificationLine}`;
      }
      if (changed.text !== "") {
        return changed.truncated
          ? `변경한 영역은 ${changed.text} 등입니다.`
          : `변경한 영역은 ${changed.text}입니다.`;
      }
      if (verification.text !== "") {
        return verification.truncated
          ? `검증 항목은 ${verification.text} 등을 점검했습니다.`
          : `검증 항목은 ${verification.text}까지 점검했습니다.`;
      }
      return "";
    }
  }
}

export function createPublicOutcomeNarrative(result: ResultFile): string {
  const completed = createCompletedItemsSentence(result);
  const outcome = createPublicOutcomeDetail(result);
  return normalizeWhitespace([completed, outcome].filter(Boolean).join(" "));
}

export function createRequestBrief(request: string): string {
  const normalized = normalizeWhitespace(request);
  if (normalized === "") {
    return "요청 처리";
  }

  return truncateText(normalized, 28);
}

export function createRequestSummary(request: string): string {
  const normalized = stripControlTokens(request);
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

export function createPublicBriefingTitle(
  request: string,
  phase: PublicBriefingPhase,
): string {
  const subject = deriveRequestSubject(request);
  switch (phase) {
    case "intake":
      return `${subject} 착수`;
    case "progress":
      return `${subject} 진행 결과`;
    case "retry":
      return `${subject} 보완 진행`;
    case "final":
      return `${subject} 최종 결과`;
    case "status":
      return `${subject} 현재 상태`;
  }
}

export function createPublicRequestLead(
  request: string,
  phase: PublicBriefingPhase,
): string {
  const subject = deriveRequestSubject(request);
  const action = deriveActionLabel(request);
  switch (phase) {
    case "intake":
      return `요청하신 ${subject} ${action} 건을 실행 가능한 작업으로 정리했고, 바로 착수 가능한 상태로 맞췄습니다.`;
    case "progress":
      return `요청하신 ${subject} ${action} 건은 1차 결과를 확보했고, 이번 mission에서 만든 내용을 기준으로 정리하고 있습니다.`;
    case "retry":
      return `요청하신 ${subject} ${action} 건은 현재 결과만으로 마감 근거가 부족해 보완 실행으로 이어갑니다.`;
    case "final":
      return `요청하신 ${subject} ${action} 건은 이번 mission 범위까지 정리를 마쳤습니다.`;
    case "status":
      return `요청하신 ${subject} ${action} 건의 현재 진행 상태를 최신 기준으로 정리해드립니다.`;
  }
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
    completed: `${routing.worker} / ${routing.tier} 담당에 요청을 전달했고 바로 착수할 수 있도록 준비를 마쳤습니다.`,
    transitionReason:
      "입력 자료와 작업 경계가 정리돼 worker가 별도 확인 없이 바로 실행할 수 있습니다.",
    next: `${routing.worker} / ${routing.tier}가 작업을 수행하고 결과 산출물을 작성합니다.`,
    evidence: packetPath,
  };
}

export function buildHandoffCompletedReport(
  requestSummary: string,
  result: ResultFile,
): CeoStageReport {
  const resultSummary = withPeriod(result.result_summary);
  const progressTransition =
    result.remaining_work.length > 0
      ? "현재 확보한 결과를 기준으로 남은 작업과 후속 우선순위를 바로 정리할 수 있습니다."
      : "현재 확보한 결과를 기준으로 이번 mission을 바로 마감 정리할 수 있습니다.";
  return {
    stage: "결과 확보",
    requestSummary,
    snapshot: normalizeWhitespace(
      [resultSummary, progressTransition].join(" "),
    ),
    completed: createPublicOutcomeNarrative(result),
    transitionReason:
      result.remaining_work.length > 0
        ? "핵심 결과가 확보돼 남은 작업과 후속 우선순위를 분리해 정리할 수 있습니다."
        : "핵심 결과가 확보돼 이번 mission을 마감 정리할 수 있습니다.",
    next:
      result.remaining_work[0] ?? "mission note와 후속 필요 여부를 정리합니다.",
    evidence: result.result_summary,
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
