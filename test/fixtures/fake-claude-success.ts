import * as fs from "node:fs/promises";
import * as path from "node:path";

const artifactDir = process.env["CO_ARTIFACT_DIR"];
const outcomeKind = process.env["CO_OUTCOME_KIND"] ?? "research_brief";
const canonicalDeliverable =
  process.env["CO_CANONICAL_DELIVERABLE"] ?? "RESEARCH.md";
const workspaceDir = process.env["CO_WORKSPACE_DIR"];
if (!artifactDir) {
  throw new Error("CO_ARTIFACT_DIR is required");
}
await fs.mkdir(artifactDir, { recursive: true });
if (outcomeKind === "code_change" && workspaceDir) {
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.writeFile(
    path.join(workspaceDir, "implemented.txt"),
    "ok\n",
    "utf8",
  );
}
await fs.writeFile(
  path.join(artifactDir, "summary.md"),
  "# summary\n\nok\n",
  "utf8",
);
await fs.writeFile(
  path.join(artifactDir, canonicalDeliverable),
  `# ${canonicalDeliverable}\n\nok\n`,
  "utf8",
);
await fs.writeFile(
  path.join(artifactDir, "result.json"),
  JSON.stringify(
    outcomeKind === "code_change"
      ? {
          outcome_kind: "code_change",
          result_summary: "투두앱 작업 경로와 구현 내용을 정리했습니다.",
          completed_items: ["구현 반영", "결과 정리"],
          remaining_work: [],
          risks: [],
          deliverable_refs: [path.join(artifactDir, canonicalDeliverable)],
          workspace_ref: workspaceDir,
          changed_paths: ["implemented.txt"],
          verification: ["fixture verification"],
          follow_up_tasks: [],
        }
      : {
          outcome_kind: outcomeKind,
          result_summary: "요청 결과를 정리하고 핵심 산출물을 준비했습니다.",
          completed_items: ["결과 정리", "문서 작성"],
          remaining_work: [],
          risks: [],
          deliverable_refs: [path.join(artifactDir, canonicalDeliverable)],
          key_findings: ["핵심 1", "핵심 2", "핵심 3"],
          recommended_next_steps: ["다음 단계 진행"],
          documents_created:
            outcomeKind === "plan_package" ? [canonicalDeliverable] : undefined,
          design_decisions:
            outcomeKind === "design_package" ? ["디자인 결정"] : undefined,
        },
    null,
    2,
  ),
  "utf8",
);
process.stdout.write(`${JSON.stringify({ type: "message", text: "done" })}\n`);
