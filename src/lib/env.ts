import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as process from "node:process";

const DEFAULT_RUNTIME_ENV = ".config/cyber-office-v2/runtime.env";
const DEFAULT_LEGACY_ENV = ".config/cyber-office-v2/launchd.env";

const DEFAULT_ENV_VALUES: Record<string, string> = {
  DISCORD_CEO_BOT_TOKEN: "",
  DISCORD_GOD_BOT_TOKEN: "",
  DISCORD_ADMIN_USER_IDS: "",
  CO_SUPERVISOR_INTERVAL_MS: "30000",
  CO_OBSIDIAN_PROJECTS_ROOT: "",
  CLAUDE_BIN: "claude",
  ANTHROPIC_API_KEY: "",
  OPENAI_API_KEY: "",
};

function expandHome(filePath: string): string {
  if (filePath.startsWith("~/")) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseEnvFile(raw: string): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1);
    if (key !== "") {
      parsed[key] = stripQuotes(value);
    }
  }

  return parsed;
}

async function readEnvFile(
  filePath: string,
): Promise<Record<string, string> | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return parseEnvFile(raw);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export function resolveRuntimeEnvFiles(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const primary = expandHome(
    env["CO_RUNTIME_ENV_FILE"] ?? path.join(os.homedir(), DEFAULT_RUNTIME_ENV),
  );
  const legacy = expandHome(
    env["CO_LAUNCHD_ENV_FILE"] ?? path.join(os.homedir(), DEFAULT_LEGACY_ENV),
  );
  return [primary, legacy];
}

export async function loadRuntimeEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  for (const filePath of resolveRuntimeEnvFiles(env)) {
    const loaded = await readEnvFile(filePath);
    if (loaded) {
      for (const [key, value] of Object.entries(loaded)) {
        if (env[key] === undefined || env[key] === "") {
          env[key] = value;
        }
      }
      break;
    }
  }

  for (const [key, value] of Object.entries(DEFAULT_ENV_VALUES)) {
    if (env[key] === undefined) {
      env[key] = value;
    }
  }

  return env;
}
