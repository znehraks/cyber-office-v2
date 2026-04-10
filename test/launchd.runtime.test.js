import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

test("launchd templates and scripts are wired", async () => {
  const install = await fs.readFile(path.join(root, "scripts/install-launchd-services.sh"), "utf8");
  const envLoader = await fs.readFile(path.join(root, "scripts/load-launchd-env.sh"), "utf8");
  const ceoPlist = await fs.readFile(path.join(root, "launchd/com.znehraks.cyber-office-v2.ceo.plist"), "utf8");
  const godPlist = await fs.readFile(path.join(root, "launchd/com.znehraks.cyber-office-v2.god.plist"), "utf8");
  const supervisorPlist = await fs.readFile(
    path.join(root, "launchd/com.znehraks.cyber-office-v2.supervisor.plist"),
    "utf8",
  );

  assert.match(envLoader, /launchd\.env/);
  assert.match(envLoader, /DISCORD_CEO_BOT_TOKEN/);
  assert.match(envLoader, /DISCORD_GOD_BOT_TOKEN/);

  assert.match(install, /Skipped ceo bootstrap/);
  assert.match(install, /Skipped god bootstrap/);
  assert.match(install, /com\.znehraks\.cyber-office-v2\.supervisor/);
  assert.match(install, /\.local\/share\/cyber-office-v2\/current/);

  for (const [label, plist] of [
    ["ceo", ceoPlist],
    ["god", godPlist],
    ["supervisor", supervisorPlist],
  ]) {
    assert.match(plist, new RegExp(`com\\.znehraks\\.cyber-office-v2\\.${label}`));
    assert.match(plist, /__ROOT__/);
    assert.match(plist, /__ENV_FILE__/);
    assert.match(plist, /RunAtLoad/);
    assert.match(plist, /KeepAlive/);
    assert.match(plist, /__HOME__/);
  }
});
