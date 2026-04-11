import * as assert from "node:assert/strict";
import { test } from "node:test";

import { parseClaudeStreamOutput } from "../src/lib/claude-output.js";

test("parseClaudeStreamOutput extracts assistant text and result errors", () => {
  const parsed = parseClaudeStreamOutput(
    [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "첫째 줄" },
            { type: "text", text: "둘째 줄" },
          ],
        },
      }),
      JSON.stringify({
        type: "result",
        is_error: true,
        result: "Not logged in · Please run /login",
      }),
    ].join("\n"),
  );

  assert.equal(parsed.summaryText, "첫째 줄\n\n둘째 줄");
  assert.equal(parsed.errorText, "Not logged in · Please run /login");
});
