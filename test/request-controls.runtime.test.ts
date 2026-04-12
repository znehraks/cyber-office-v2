import * as assert from "node:assert/strict";
import { test } from "node:test";

import { parseRequestExecutionControls } from "../src/lib/request-controls.js";

test("parseRequestExecutionControls strips hidden retry tokens from the stored request", () => {
  const parsed = parseRequestExecutionControls(
    "간단한 투두앱을 구현해줘 [[co:e2e-retry]]",
  );

  assert.equal(parsed.cleanedRequest, "간단한 투두앱을 구현해줘");
  assert.equal(parsed.testScenario, "retry-once");
});
