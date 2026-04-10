import test from "node:test";
import assert from "node:assert/strict";

import { ensureReplyChannel, stripBotMention } from "../src/lib/discord-routing.js";

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
