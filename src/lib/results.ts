import * as fs from "node:fs/promises";
import * as path from "node:path";

import type {
  OutcomeKind,
  ResultFile,
  RoutingDecision,
} from "../types/domain.js";
import { parseResultFile } from "../types/domain.js";
import { exists, readJson } from "./runtime.js";

const FORBIDDEN_SUMMARY_PREFIX =
  /^(job|mission|worker|summary|result|status)\s*:/iu;

export function classifyOutcomeKind(
  request: string,
  routing: RoutingDecision,
): OutcomeKind {
  if (
    [
      "researcher",
      "researcher-high",
      "devil-advocate",
      "devil-advocate-high",
      "legal-reviewer",
      "legal-reviewer-high",
    ].includes(routing.worker)
  ) {
    return "research_brief";
  }
  if (
    ["planner-high", "writer", "marketer", "sales"].includes(routing.worker)
  ) {
    return "plan_package";
  }
  if (
    [
      "ui-ux-designer",
      "ui-ux-designer-high",
      "3d-modeler",
      "ar-xr-master",
      "creative-brainstormer",
      "ai-creator",
    ].includes(routing.worker)
  ) {
    return "design_package";
  }
  if (/(구현|개발|앱|app|feature|fix|버그|만들)/iu.test(request)) {
    return "code_change";
  }
  return "research_brief";
}

export function canonicalDeliverableFileName(outcomeKind: OutcomeKind): string {
  switch (outcomeKind) {
    case "research_brief":
      return "RESEARCH.md";
    case "plan_package":
      return "PLAN.md";
    case "design_package":
      return "DESIGN.md";
    case "code_change":
      return "IMPLEMENTATION.md";
  }
}

export function resultFilePath(artifactDir: string): string {
  return path.join(artifactDir, "result.json");
}

export async function readResultFile(artifactDir: string): Promise<ResultFile> {
  return readJson(resultFilePath(artifactDir), parseResultFile);
}

function assertSummaryQuality(resultSummary: string): void {
  const trimmed = resultSummary.trim();
  if (trimmed.length < 12) {
    throw new Error("result.json result_summary is too short");
  }
  if (FORBIDDEN_SUMMARY_PREFIX.test(trimmed)) {
    throw new Error("result.json result_summary is not user-meaningful");
  }
}

async function assertDeliverableRefsExist(result: ResultFile): Promise<void> {
  if (result.deliverable_refs.length === 0) {
    throw new Error("result.json requires at least one deliverable ref");
  }
  for (const ref of result.deliverable_refs) {
    if (!(await exists(ref))) {
      throw new Error(`result.json deliverable ref missing: ${ref}`);
    }
  }
}

async function assertCodeChangePaths(result: ResultFile): Promise<void> {
  if (!result.workspace_ref) {
    throw new Error("result.json code_change requires workspace_ref");
  }
  if (!result.changed_paths || result.changed_paths.length === 0) {
    throw new Error("result.json code_change requires changed_paths");
  }
  if (!result.verification || result.verification.length === 0) {
    throw new Error("result.json code_change requires verification");
  }
  for (const changedPath of result.changed_paths) {
    const absolutePath = path.isAbsolute(changedPath)
      ? changedPath
      : path.join(result.workspace_ref, changedPath);
    const relative = path.relative(result.workspace_ref, absolutePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`changed path escapes workspace: ${changedPath}`);
    }
    if (!(await exists(absolutePath))) {
      throw new Error(`changed path missing from workspace: ${changedPath}`);
    }
  }
}

function assertOutcomeSpecificFields(result: ResultFile): void {
  if (result.completed_items.length === 0) {
    throw new Error("result.json requires completed_items");
  }
  switch (result.outcome_kind) {
    case "research_brief":
      if ((result.key_findings?.length ?? 0) < 3) {
        throw new Error(
          "result.json research_brief requires at least 3 key_findings",
        );
      }
      if ((result.recommended_next_steps?.length ?? 0) < 1) {
        throw new Error(
          "result.json research_brief requires recommended_next_steps",
        );
      }
      break;
    case "plan_package":
      if ((result.documents_created?.length ?? 0) < 1) {
        throw new Error("result.json plan_package requires documents_created");
      }
      break;
    case "design_package":
      if ((result.design_decisions?.length ?? 0) < 1) {
        throw new Error("result.json design_package requires design_decisions");
      }
      break;
    case "code_change":
      break;
  }
}

export async function assertResultArtifacts(input: {
  artifactDir: string;
  outcomeKind: OutcomeKind;
  canonicalDeliverableName: string;
}): Promise<ResultFile> {
  const result = await readResultFile(input.artifactDir);
  if (result.outcome_kind !== input.outcomeKind) {
    throw new Error(
      `result.json outcome_kind mismatch: expected ${input.outcomeKind}, got ${result.outcome_kind}`,
    );
  }
  assertSummaryQuality(result.result_summary);
  assertOutcomeSpecificFields(result);
  await assertDeliverableRefsExist(result);
  const canonicalPath = path.join(
    input.artifactDir,
    input.canonicalDeliverableName,
  );
  if (!(await exists(canonicalPath))) {
    throw new Error(`canonical deliverable missing: ${canonicalPath}`);
  }
  if (!result.deliverable_refs.includes(canonicalPath)) {
    throw new Error(
      `result.json must include canonical deliverable ref: ${canonicalPath}`,
    );
  }
  if (result.outcome_kind === "code_change") {
    await assertCodeChangePaths(result);
  }
  return result;
}
