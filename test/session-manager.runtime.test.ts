import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
  SERVICE_DEFINITIONS,
  assertNoLegacyConflicts,
  buildServiceCommand,
  findActiveLegacyServices,
  parseTmuxWindowRows,
  planSessionOperations,
} from "../src/lib/session-manager.js";

test("buildServiceCommand runs compiled dist entrypoints instead of shell scripts", () => {
  const root = "/Users/designc/Documents/cyber-office-v2";
  const [firstService] = SERVICE_DEFINITIONS;
  assert.ok(firstService);
  const command = buildServiceCommand(root, firstService);

  assert.match(command, /^exec bash -lc /);
  assert.match(command, /Users\/designc\/Documents\/cyber-office-v2/);
  assert.match(command, /dist\/src\/discord-bot\.js/);
  assert.doesNotMatch(command, /scripts\/run-discord-ceo\.sh/);
});

test("parseTmuxWindowRows parses running and dead windows", () => {
  const rows = parseTmuxWindowRows(
    ["ceo\t0\t123\tnode", "god\t1\t456\tbash", "supervisor\t0\t789\tnode"].join(
      "\n",
    ),
  );

  assert.deepEqual(rows, [
    { name: "ceo", dead: false, pid: 123, command: "node" },
    { name: "god", dead: true, pid: 456, command: "bash" },
    { name: "supervisor", dead: false, pid: 789, command: "node" },
  ]);
});

test("planSessionOperations creates missing windows and respawns only dead ones", () => {
  const operations = planSessionOperations([
    { name: "ceo", dead: false, pid: 123, command: "node" },
    { name: "god", dead: true, pid: 456, command: "bash" },
  ]);

  assert.deepEqual(operations, [
    { type: "respawn_window", service: "god" },
    { type: "create_window", service: "supervisor" },
  ]);
});

test("findActiveLegacyServices returns only loaded cyber-office labels", async () => {
  const active = await findActiveLegacyServices({
    inspectLabel: async (label) =>
      label.endsWith(".ceo") || label.endsWith(".supervisor"),
  });

  assert.deepEqual(active, [
    "com.znehraks.cyber-office-v2.ceo",
    "com.znehraks.cyber-office-v2.supervisor",
  ]);
});

test("assertNoLegacyConflicts fails fast when launchd services are active", async () => {
  await assert.rejects(
    () =>
      assertNoLegacyConflicts({
        inspectLabel: async (label) => label.endsWith(".god"),
      }),
    /legacy launchd services are still active/,
  );
});
