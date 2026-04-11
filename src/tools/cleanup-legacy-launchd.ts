#!/usr/bin/env node
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const LEGACY_LABELS = [
  "com.znehraks.cyber-office-v2.ceo",
  "com.znehraks.cyber-office-v2.god",
  "com.znehraks.cyber-office-v2.supervisor",
];

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", () => resolve());
  });
}

async function main(): Promise<void> {
  const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
  const uid =
    typeof process.getuid === "function" ? String(process.getuid()) : null;

  for (const label of LEGACY_LABELS) {
    if (uid) {
      await run("launchctl", ["bootout", `gui/${uid}/${label}`]).catch(
        () => undefined,
      );
    }
    await fs.rm(path.join(launchAgentsDir, `${label}.plist`), { force: true });
  }

  process.stdout.write("Removed legacy launchd services.\n");
}

void main();
