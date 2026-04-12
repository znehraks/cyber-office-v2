import * as fs from "node:fs/promises";
import * as path from "node:path";

const artifactDir = process.env["CO_ARTIFACT_DIR"];
const canonicalDeliverable =
  process.env["CO_CANONICAL_DELIVERABLE"] ?? "RESEARCH.md";
if (!artifactDir) {
  throw new Error("CO_ARTIFACT_DIR is required");
}

const permissionModeIndex = process.argv.indexOf("--permission-mode");
const permissionMode =
  permissionModeIndex >= 0 ? process.argv[permissionModeIndex + 1] : undefined;

if (permissionMode !== "acceptEdits") {
  throw new Error(
    `expected --permission-mode acceptEdits, got ${permissionMode ?? "missing"}`,
  );
}

await fs.mkdir(artifactDir, { recursive: true });
await fs.writeFile(
  path.join(artifactDir, "summary.md"),
  "# summary\n\npermission ok\n",
  "utf8",
);
await fs.writeFile(
  path.join(artifactDir, canonicalDeliverable),
  `# ${canonicalDeliverable}\n\npermission ok\n`,
  "utf8",
);
await fs.writeFile(
  path.join(artifactDir, "result.json"),
  JSON.stringify(
    {
      outcome_kind: "research_brief",
      result_summary: "권한 모드와 산출물 구성을 함께 검증했습니다.",
      completed_items: ["권한 모드 확인", "산출물 작성"],
      remaining_work: [],
      risks: [],
      deliverable_refs: [path.join(artifactDir, canonicalDeliverable)],
      key_findings: ["권한 전달 확인", "summary 생성", "result 생성"],
      recommended_next_steps: ["실행 경로 유지"],
    },
    null,
    2,
  ),
  "utf8",
);
process.stdout.write(`${JSON.stringify({ type: "message", text: "done" })}\n`);
