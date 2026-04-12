import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { bootstrapRuntimeWorkers } from "../src/lib/bootstrap.js";
import {
  renderDiscordFinalMessage,
  renderDiscordReportBriefing,
} from "../src/lib/discord-briefing.js";
import { listJobsForMission } from "../src/lib/jobs.js";
import {
  classifyRequest,
  executeMissionFlow,
  parseGodCommand,
} from "../src/lib/orchestrator.js";
import { ensureRuntimeLayout, readJson } from "../src/lib/runtime.js";
import { parseCloseoutFile, parseMission } from "../src/types/domain.js";

async function makeRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "co-v2-orch-"));
  await ensureRuntimeLayout(root);
  await bootstrapRuntimeWorkers(root);
  await fs.writeFile(path.join(root, "README.md"), "# runtime\n", "utf8");
  return root;
}

test("classifyRequest routes niche domains to the expected specialist roles", () => {
  assert.equal(
    classifyRequest("모바일 앱 온보딩 플로우 수정").worker,
    "app-dev",
  );
  assert.equal(
    classifyRequest("AR 필터와 WebXR 데모 설계").worker,
    "ar-xr-master",
  );
  assert.equal(classifyRequest("계약서 리스크 검토").worker, "legal-reviewer");
  assert.equal(classifyRequest("랜딩 페이지 카피 작성").worker, "writer");
  assert.equal(classifyRequest("3D 모델 최적화").worker, "3d-modeler");
});

test("executeMissionFlow completes a one-shot ceo mission with reports and closeout", async () => {
  const root = await makeRoot();
  const obsidianRoot = await fs.mkdtemp(path.join(os.tmpdir(), "co-v2-notes-"));
  const projectDir = path.join(obsidianRoot, "sns-app");
  await fs.mkdir(projectDir, { recursive: true });
  process.env["CO_OBSIDIAN_PROJECTS_ROOT"] = obsidianRoot;
  const result = await executeMissionFlow(root, {
    source: "discord",
    messageId: "orch-1",
    chatId: "thread-1",
    request: "로그인 이슈를 조사해줘",
    claudeBin: process.execPath,
    extraArgs: [path.resolve("dist/test/fixtures/fake-claude-success.js")],
    projectRef: {
      project_slug: "sns-app",
      display_name: "SNS App",
      discord_channel_id: "channel-sns",
      obsidian_rel_dir: "sns-app",
      obsidian_project_dir: projectDir,
    },
    epicRef: {
      epic_id: "epic-login",
      project_slug: "sns-app",
      title: "로그인 플로우",
      slug: "로그인-플로우",
      discord_thread_id: "thread-1",
      status: "open",
      active_mission_id: null,
      obsidian_note_ref: path.join(
        projectDir,
        "_cyber-office",
        "epics",
        "로그인-플로우",
        "EPIC.md",
      ),
      created_at: "2026-04-12T00:00:00.000Z",
      updated_at: "2026-04-12T00:00:00.000Z",
    },
  });

  assert.equal(result.missionId.startsWith("mission-"), true);
  assert.equal(result.workerResult.status, "completed");
  assert.equal(result.closeout.status, "passed");
  assert.equal(result.routing.worker, "researcher");
  assert.equal(result.requestBrief, "로그인 이슈를 조사해줘");
  assert.deepEqual(
    result.reports.map((report) => report.stage),
    ["요청 검토", "담당 배정", "결과 확보", "마감 점검", "최종 마감"],
  );

  const combined = result.reports.map((report) => report.content).join("\n\n");
  for (const label of [
    "한눈요약",
    "요청 요지",
    "현재 단계",
    "방금 진행한 내용",
    "단계 전환 이유",
    "다음 조치",
    "담당",
  ]) {
    assert.match(combined, new RegExp(`^${label}: `, "m"));
  }

  assert.doesNotMatch(
    combined,
    /default standard|category=|clean path|verify 시작/,
  );
  assert.match(result.reports[0]?.content ?? "", /배정 단계로 넘어갑니다/);
  assert.match(result.reports[1]?.content ?? "", /요청을 전달했고 바로 착수/);
  assert.doesNotMatch(result.reports[2]?.content ?? "", /summary\.md/);
  assert.match(result.reports[2]?.content ?? "", /결과 정리, 문서 작성/);
  assert.match(result.reports[3]?.content ?? "", /재시도 필요 여부/);
  assert.match(result.reports[4]?.content ?? "", /mission 완료를 확정/);

  const missionNotePath = path.join(
    projectDir,
    "_cyber-office",
    "epics",
    "로그인-플로우",
    "missions",
    `${result.missionId}.md`,
  );
  const epicNotePath = path.join(
    projectDir,
    "_cyber-office",
    "epics",
    "로그인-플로우",
    "EPIC.md",
  );

  const publicReports = result.reports
    .map((report) =>
      renderDiscordReportBriefing(report, {
        requestText: "로그인 이슈를 조사해줘",
        notePath: missionNotePath,
        obsidianProjectsRoot: obsidianRoot,
      }),
    )
    .filter((report): report is string => report !== null);
  assert.equal(publicReports.length, 2);
  assert.match(publicReports[0] ?? "", /^\[접수] 로그인 이슈 착수$/m);
  assert.match(publicReports[1] ?? "", /^\[진행] 로그인 이슈 진행 결과$/m);
  assert.doesNotMatch(
    publicReports.join("\n\n"),
    /한눈요약:|요청 요지:|현재 단계:|방금 진행한 내용:|단계 전환 이유:|summary\.md/,
  );
  assert.match(publicReports.join("\n\n"), /^다음: /m);
  assert.match(publicReports.join("\n\n"), /^담당: ceo \/ standard$/m);
  assert.match(
    publicReports[1] ?? "",
    /^상세 문서: sns-app\/_cyber-office\/epics\/로그인-플로우\/missions\/.*\.md$/m,
  );

  const finalMessage = renderDiscordFinalMessage({
    requestText: "로그인 이슈를 조사해줘",
    missionId: result.missionId,
    worker: result.routing.worker,
    tier: result.routing.tier,
    resultFile: result.resultFile,
    nextStep: result.nextStep,
    notePath: result.missionNotePath,
    obsidianProjectsRoot: obsidianRoot,
    summaryPath: result.workerResult.summaryPath,
    closeoutStatus: result.closeout.status,
  });
  assert.match(finalMessage, /^\[최종 결과] 로그인 이슈 최종 결과$/m);
  assert.doesNotMatch(finalMessage, /^summary: /m);
  assert.match(finalMessage, /^closeout: passed$/m);
  assert.match(
    finalMessage,
    /^상세 문서: sns-app\/_cyber-office\/epics\/로그인-플로우\/missions\/.*\.md$/m,
  );

  const mission = await readJson(
    path.join(root, "runtime", "missions", `${result.missionId}.json`),
    parseMission,
  );
  assert.equal(mission.project_ref.project_slug, "sns-app");
  assert.equal(mission.epic_ref.epic_id, "epic-login");
  const [missionNote, epicNote, closeout] = await Promise.all([
    fs.readFile(missionNotePath, "utf8"),
    fs.readFile(epicNotePath, "utf8"),
    readJson(
      path.join(
        root,
        "runtime",
        "artifacts",
        result.missionId,
        "closeout.json",
      ),
      parseCloseoutFile,
    ),
  ]);
  assert.match(missionNote, /실제로 만든 것 또는 바뀐 것/);
  assert.match(missionNote, /요청 결과를 정리하고 핵심 산출물을 준비했습니다/);
  assert.match(missionNote, /canonical deliverable ref/);
  assert.match(epicNote, /열린 mission \/ 종료 mission 목록/);
  assert.equal(closeout.obsidian_note_ref, missionNotePath);
  assert.doesNotMatch(finalMessage, /^note: /m);
});

test("parseGodCommand recognizes admin operations and rejects freeform text", () => {
  assert.deepEqual(parseGodCommand("status"), { command: "status", args: [] });
  assert.deepEqual(parseGodCommand("doctor"), { command: "doctor", args: [] });
  assert.deepEqual(parseGodCommand("supervisor tick"), {
    command: "supervisor",
    args: ["tick"],
  });
  assert.equal(parseGodCommand("그냥 대화"), null);
});

test("executeMissionFlow emits a single public retry briefing on the deterministic retry path", async () => {
  const root = await makeRoot();
  const obsidianRoot = await fs.mkdtemp(path.join(os.tmpdir(), "co-v2-notes-"));
  const projectDir = path.join(obsidianRoot, "retry-app");
  await fs.mkdir(projectDir, { recursive: true });
  process.env["CO_OBSIDIAN_PROJECTS_ROOT"] = obsidianRoot;

  const result = await executeMissionFlow(root, {
    source: "discord",
    messageId: "orch-retry-1",
    chatId: "thread-retry-1",
    request: "로그인 이슈를 조사해줘",
    testScenario: "retry-once",
    projectRef: {
      project_slug: "retry-app",
      display_name: "Retry App",
      discord_channel_id: "channel-retry",
      obsidian_rel_dir: "retry-app",
      obsidian_project_dir: projectDir,
    },
    epicRef: {
      epic_id: "epic-retry",
      project_slug: "retry-app",
      title: "retry epic",
      slug: "retry-epic",
      discord_thread_id: "thread-retry-1",
      status: "open",
      active_mission_id: null,
      obsidian_note_ref: path.join(
        projectDir,
        "_cyber-office",
        "epics",
        "retry-epic",
        "EPIC.md",
      ),
      created_at: "2026-04-12T00:00:00.000Z",
      updated_at: "2026-04-12T00:00:00.000Z",
    },
  });

  assert.equal(result.closeout.status, "passed");
  const jobs = await listJobsForMission(root, result.missionId);
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0]?.status, "failed");
  assert.equal(jobs[1]?.status, "completed");

  const publicReports = result.reports
    .map((report) =>
      renderDiscordReportBriefing(report, {
        requestText: "로그인 이슈를 조사해줘",
        notePath: path.join(
          projectDir,
          "_cyber-office",
          "epics",
          "retry-epic",
          "missions",
          `${result.missionId}.md`,
        ),
        obsidianProjectsRoot: obsidianRoot,
      }),
    )
    .filter((report): report is string => report !== null);
  assert.equal(publicReports.length, 3);
  assert.match(publicReports[0] ?? "", /^\[접수] 로그인 이슈 착수$/m);
  assert.match(publicReports[1] ?? "", /^\[보완 진행] 로그인 이슈 보완 진행$/m);
  assert.match(publicReports[2] ?? "", /^\[진행] 로그인 이슈 진행 결과$/m);
  assert.equal(
    result.reports.some(
      (report) =>
        report.report_key === "job.retried" &&
        report.evidence === "재시도 없음",
    ),
    false,
  );
});
