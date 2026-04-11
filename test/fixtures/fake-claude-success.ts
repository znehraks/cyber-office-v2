import * as fs from "node:fs/promises";
import * as path from "node:path";

const artifactDir = process.env["CO_ARTIFACT_DIR"];
if (!artifactDir) {
  throw new Error("CO_ARTIFACT_DIR is required");
}
await fs.mkdir(artifactDir, { recursive: true });
await fs.writeFile(
  path.join(artifactDir, "summary.md"),
  "# summary\n\nok\n",
  "utf8",
);
process.stdout.write(`${JSON.stringify({ type: "message", text: "done" })}\n`);
