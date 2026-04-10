import fs from "node:fs/promises";
import path from "node:path";

const artifactDir = process.env.CO_ARTIFACT_DIR;
await fs.mkdir(artifactDir, { recursive: true });
await fs.writeFile(path.join(artifactDir, "summary.md"), "# summary\n\nok\n", "utf8");
process.stdout.write(JSON.stringify({ type: "message", text: "done" }) + "\n");
