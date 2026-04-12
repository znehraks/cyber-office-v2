import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
  ensureReplyChannel,
  parseEpicHeader,
  parseResolutionChoice,
  shouldHandleCeoIngress,
  stripBotMention,
} from "../src/lib/discord-routing.js";

test("stripBotMention removes direct bot mentions and owned role mentions", () => {
  const channel = {
    type: 0,
    isThread() {
      return false;
    },
  };
  const message = {
    content: "<@123> <@&456> 답해봐",
    guildId: "guild-1",
    guild: {
      members: {
        me: {
          roles: {
            cache: new Map([["456", {}]]),
          },
        },
      },
    },
    channel,
  };

  assert.equal(stripBotMention(message, { user: { id: "123" } }), "답해봐");
});

test("ensureReplyChannel does not spawn a new thread for channel mentions", async () => {
  const channel = {
    type: 0,
    isThread() {
      return false;
    },
  };

  const result = await ensureReplyChannel({ channel });
  assert.equal(result, channel);
});

test("parseEpicHeader extracts the first-line epic header and preserves the remaining request body", () => {
  const parsed = parseEpicHeader("epic: 로그인 플로우\n로그인 이슈를 조사해줘");
  assert.deepEqual(parsed, {
    epicTitle: "로그인 플로우",
    requestBody: "로그인 이슈를 조사해줘",
  });
});

test("parseResolutionChoice accepts candidate numbers and new", () => {
  assert.deepEqual(parseResolutionChoice("1"), {
    kind: "candidate",
    index: 0,
  });
  assert.deepEqual(parseResolutionChoice("3"), {
    kind: "candidate",
    index: 2,
  });
  assert.deepEqual(parseResolutionChoice("new"), { kind: "new" });
  assert.equal(parseResolutionChoice("abc"), null);
});

test("shouldHandleCeoIngress allows managed threads and pending resolution replies without mentions", () => {
  assert.equal(
    shouldHandleCeoIngress({
      isDm: false,
      mentioned: false,
      isManagedEpicThread: true,
      hasPendingResolutionChoice: false,
    }),
    true,
  );
  assert.equal(
    shouldHandleCeoIngress({
      isDm: false,
      mentioned: false,
      isManagedEpicThread: false,
      hasPendingResolutionChoice: true,
    }),
    true,
  );
  assert.equal(
    shouldHandleCeoIngress({
      isDm: false,
      mentioned: false,
      isManagedEpicThread: false,
      hasPendingResolutionChoice: false,
    }),
    false,
  );
});
