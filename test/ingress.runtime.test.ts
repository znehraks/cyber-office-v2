import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import {
  claimIngress,
  ingestIngressEvent,
  recoverStaleIngressClaims,
} from "../src/lib/ingress.js";
import { ensureRuntimeLayout } from "../src/lib/runtime.js";
import type { IngressPayload } from "../src/types/domain.js";

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "co-v2-ingress-"));
  await ensureRuntimeLayout(root);
  return root;
}

function buildProjectContext() {
  return {
    projectRef: {
      project_slug: "sns-app",
      display_name: "SNS App",
      discord_channel_id: "channel-sns",
      obsidian_rel_dir: "sns-app",
      obsidian_project_dir: "/tmp/sns-app",
    },
    epicRef: {
      epic_id: "epic-login",
      project_slug: "sns-app",
      title: "로그인 플로우",
      slug: "로그인-플로우",
      discord_thread_id: "chat-1",
      status: "open" as const,
      active_mission_id: null,
      obsidian_note_ref:
        "/tmp/sns-app/_cyber-office/epics/로그인-플로우/EPIC.md",
      created_at: "2026-04-12T00:00:00.000Z",
      updated_at: "2026-04-12T00:00:00.000Z",
    },
  };
}

test("same discord message id creates exactly one mission", async () => {
  const root = await makeRoot();
  const payload: IngressPayload = {
    source: "discord",
    eventType: "message_create",
    upstreamEventId: "12345",
    threadRef: { chatId: "chat-1", messageId: "12345" },
    ...buildProjectContext(),
    userRequest: "로그인 플로우 고쳐줘",
    category: "standard",
    priorityFloor: "P1",
  };

  const [first, second] = await Promise.all([
    ingestIngressEvent(root, payload),
    ingestIngressEvent(root, payload),
  ]);

  const missionFiles = await fs.readdir(path.join(root, "runtime", "missions"));
  assert.equal(missionFiles.length, 1);
  assert.equal(first.missionId, second.missionId);
  assert.equal(first.ingressKey, second.ingressKey);
  assert.equal(first.duplicate || second.duplicate, true);
});

test("same text with different message ids creates two missions", async () => {
  const root = await makeRoot();

  const first = await ingestIngressEvent(root, {
    source: "discord",
    eventType: "message_create",
    upstreamEventId: "a-1",
    threadRef: { chatId: "chat-1", messageId: "a-1" },
    ...buildProjectContext(),
    userRequest: "같은 텍스트",
    category: "standard",
    priorityFloor: "P1",
  });
  const second = await ingestIngressEvent(root, {
    source: "discord",
    eventType: "message_create",
    upstreamEventId: "a-2",
    threadRef: { chatId: "chat-1", messageId: "a-2" },
    ...buildProjectContext(),
    userRequest: "같은 텍스트",
    category: "standard",
    priorityFloor: "P1",
  });

  const missionFiles = await fs.readdir(path.join(root, "runtime", "missions"));
  assert.equal(missionFiles.length, 2);
  assert.notEqual(first.missionId, second.missionId);
});

test("stale claimed ingress can be recovered without creating a duplicate claim", async () => {
  const root = await makeRoot();
  const now = new Date("2026-04-10T10:00:00.000Z");
  const staleAt = new Date(now.getTime() - 10 * 60 * 1000);

  const claim = await claimIngress(root, {
    source: "discord",
    eventType: "message_create",
    upstreamEventId: "stale-1",
    firstSeenAt: staleAt.toISOString(),
    claimLeaseMs: 60_000,
  });

  assert.equal(claim.status, "claimed");

  const recovered = await recoverStaleIngressClaims(root, {
    now: now.toISOString(),
    staleAfterMs: 60_000,
  });

  assert.equal(recovered.length, 1);
  const [firstRecovered] = recovered;
  assert.ok(firstRecovered);
  assert.equal(firstRecovered.status, "recovered");

  const repeated = await claimIngress(root, {
    source: "discord",
    eventType: "message_create",
    upstreamEventId: "stale-1",
    firstSeenAt: now.toISOString(),
    claimLeaseMs: 60_000,
  });

  assert.equal(repeated.status, "recovered");
  assert.equal(repeated.keyHash, claim.keyHash);
});
