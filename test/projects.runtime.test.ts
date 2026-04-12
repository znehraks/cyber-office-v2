import * as assert from "node:assert/strict";
import { test } from "node:test";

import { toObsidianRelativePath } from "../src/lib/projects.js";

test("toObsidianRelativePath trims the configured Obsidian root", () => {
  const relative = toObsidianRelativePath(
    "/obsidian/todo-app-e2e/_cyber-office/epics/todo/missions/mission-1.md",
    { CO_OBSIDIAN_PROJECTS_ROOT: "/obsidian" },
  );

  assert.equal(
    relative,
    "todo-app-e2e/_cyber-office/epics/todo/missions/mission-1.md",
  );
});

test("toObsidianRelativePath returns null for paths outside the configured root", () => {
  const relative = toObsidianRelativePath(
    "/another-root/todo-app-e2e/_cyber-office/epics/todo/missions/mission-1.md",
    { CO_OBSIDIAN_PROJECTS_ROOT: "/obsidian" },
  );

  assert.equal(relative, null);
});
