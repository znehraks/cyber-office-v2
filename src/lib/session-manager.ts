import { spawn } from "node:child_process";
import * as path from "node:path";

export const DEFAULT_SESSION_NAME =
  process.env["CO_TMUX_SESSION"] ?? "cyber-office-v2";
export const LEGACY_LAUNCHD_LABELS = [
  "com.znehraks.cyber-office-v2.ceo",
  "com.znehraks.cyber-office-v2.god",
  "com.znehraks.cyber-office-v2.supervisor",
];

export interface ServiceDefinition {
  name: "ceo" | "god" | "supervisor";
  entrypoint: string;
  args: string[];
  env: Record<string, string>;
}

export interface TmuxWindowRow {
  name: string;
  dead: boolean;
  pid: number;
  command: string;
}

export interface SessionOperation {
  type: "create_window" | "respawn_window";
  service: ServiceDefinition["name"];
}

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface RunOptions {
  cwd?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
}

interface LegacyConflictOptions extends RunOptions {
  uid?: number;
  inspectLabel?: (label: string) => Promise<boolean>;
}

interface SessionOptions extends LegacyConflictOptions {
  sessionName?: string;
  enforceNoLegacy?: boolean;
}

export interface SessionServiceStatus {
  service: ServiceDefinition["name"];
  status: "missing" | "running" | "dead";
  pid: number | null;
  dead: boolean | null;
  command: string | null;
}

export interface SessionStatus {
  sessionName: string;
  exists: boolean;
  legacyConflicts: string[];
  services: SessionServiceStatus[];
}

export interface StartSessionResult extends SessionStatus {
  operations: SessionOperation[];
}

export const SERVICE_DEFINITIONS: ServiceDefinition[] = [
  {
    name: "ceo",
    entrypoint: "dist/src/discord-bot.js",
    args: [],
    env: { CO_DISCORD_ROLE: "ceo" },
  },
  {
    name: "god",
    entrypoint: "dist/src/discord-bot.js",
    args: [],
    env: { CO_DISCORD_ROLE: "god" },
  },
  {
    name: "supervisor",
    entrypoint: "dist/src/cli.js",
    args: ["supervisor", "daemon"],
    env: {},
  },
];

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function runCaptured(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function tmux(
  args: string[],
  options: RunOptions = {},
): Promise<CommandResult> {
  const result = await runCaptured("tmux", args, options);
  if (result.code === 0) {
    return result;
  }
  throw new Error(
    result.stderr.trim() || `tmux exited with code ${String(result.code)}`,
  );
}

async function hasSession(sessionName: string): Promise<boolean> {
  try {
    await tmux(["has-session", "-t", sessionName]);
    return true;
  } catch {
    return false;
  }
}

export function buildServiceCommand(
  root: string,
  service: ServiceDefinition,
): string {
  const entrypoint = path.join(root, service.entrypoint);
  const envAssignments = Object.entries(service.env).map(
    ([key, value]) => `${key}=${shellEscape(value)}`,
  );
  const execParts = [
    "env",
    ...envAssignments,
    shellEscape(process.execPath),
    "--enable-source-maps",
    shellEscape(entrypoint),
    ...service.args.map((arg) => shellEscape(arg)),
  ];
  const shellCommand = [
    `cd ${shellEscape(root)}`,
    `exec ${execParts.join(" ")}`,
  ].join(" && ");
  return `exec bash -lc ${shellEscape(shellCommand)}`;
}

export function parseTmuxWindowRows(output: string): TmuxWindowRow[] {
  return String(output)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const [name = "", dead = "0", pid = "0", command = ""] = line.split("\t");
      return {
        name,
        dead: dead === "1",
        pid: Number(pid),
        command,
      };
    });
}

export function planSessionOperations(
  windows: TmuxWindowRow[],
): SessionOperation[] {
  const byName = new Map(windows.map((window) => [window.name, window]));
  const operations: SessionOperation[] = [];

  for (const service of SERVICE_DEFINITIONS) {
    const existing = byName.get(service.name);
    if (!existing) {
      operations.push({ type: "create_window", service: service.name });
      continue;
    }
    if (existing.dead) {
      operations.push({ type: "respawn_window", service: service.name });
    }
  }

  return operations;
}

export async function findActiveLegacyServices(
  options: LegacyConflictOptions = {},
): Promise<string[]> {
  const inspectLabel =
    options.inspectLabel ??
    (async (label: string): Promise<boolean> => {
      const uid = options.uid ?? process.getuid?.();
      if (uid === undefined) {
        return false;
      }
      const result = await runCaptured(
        "launchctl",
        ["print", `gui/${String(uid)}/${label}`],
        {
          cwd: options.cwd,
          env: options.env,
        },
      );
      return result.code === 0;
    });

  const active: string[] = [];
  for (const label of LEGACY_LAUNCHD_LABELS) {
    if (await inspectLabel(label)) {
      active.push(label);
    }
  }
  return active;
}

export async function assertNoLegacyConflicts(
  options: LegacyConflictOptions = {},
): Promise<void> {
  const active = await findActiveLegacyServices(options);
  if (active.length > 0) {
    throw new Error(
      [
        "Conflicting legacy launchd services are still active.",
        `Active labels: ${active.join(", ")}`,
        "Run `npm run legacy:cleanup` before `co start`.",
      ].join("\n"),
    );
  }
}

async function listWindows(sessionName: string): Promise<TmuxWindowRow[]> {
  const result = await tmux([
    "list-windows",
    "-t",
    sessionName,
    "-F",
    "#{window_name}\t#{pane_dead}\t#{pane_pid}\t#{pane_current_command}",
  ]);
  return parseTmuxWindowRows(result.stdout);
}

function toServiceStatus(windows: TmuxWindowRow[]): SessionServiceStatus[] {
  const byName = new Map(windows.map((window) => [window.name, window]));
  return SERVICE_DEFINITIONS.map((service) => {
    const window = byName.get(service.name);
    if (!window) {
      return {
        service: service.name,
        status: "missing",
        pid: null,
        dead: null,
        command: null,
      };
    }
    return {
      service: service.name,
      status: window.dead ? "dead" : "running",
      pid: Number.isFinite(window.pid) ? window.pid : null,
      dead: window.dead,
      command: window.command,
    };
  });
}

export async function readSessionStatus(
  _root: string,
  options: SessionOptions = {},
): Promise<SessionStatus> {
  const sessionName = options.sessionName ?? DEFAULT_SESSION_NAME;
  const legacyConflicts = await findActiveLegacyServices(options);
  const exists = await hasSession(sessionName);
  if (!exists) {
    return {
      sessionName,
      exists: false,
      legacyConflicts,
      services: toServiceStatus([]),
    };
  }

  const windows = await listWindows(sessionName);
  return {
    sessionName,
    exists: true,
    legacyConflicts,
    services: toServiceStatus(windows),
  };
}

export async function startSession(
  root: string,
  options: SessionOptions = {},
): Promise<StartSessionResult> {
  const sessionName = options.sessionName ?? DEFAULT_SESSION_NAME;
  const operations: SessionOperation[] = [];

  if (options.enforceNoLegacy !== false) {
    await assertNoLegacyConflicts(options);
  }

  if (!(await hasSession(sessionName))) {
    const [firstService, ...rest] = SERVICE_DEFINITIONS;
    if (!firstService) {
      throw new Error("No services configured");
    }

    await tmux([
      "new-session",
      "-d",
      "-s",
      sessionName,
      "-n",
      firstService.name,
      buildServiceCommand(root, firstService),
    ]);
    await tmux(["set-option", "-t", sessionName, "remain-on-exit", "on"]);
    operations.push({ type: "create_window", service: firstService.name });

    for (const service of rest) {
      await tmux([
        "new-window",
        "-d",
        "-t",
        sessionName,
        "-n",
        service.name,
        buildServiceCommand(root, service),
      ]);
      operations.push({ type: "create_window", service: service.name });
    }
  } else {
    await tmux(["set-option", "-t", sessionName, "remain-on-exit", "on"]);
    const windows = await listWindows(sessionName);
    const plan = planSessionOperations(windows);

    for (const operation of plan) {
      const service = SERVICE_DEFINITIONS.find(
        (item) => item.name === operation.service,
      );
      if (!service) {
        continue;
      }

      if (operation.type === "create_window") {
        await tmux([
          "new-window",
          "-d",
          "-t",
          sessionName,
          "-n",
          service.name,
          buildServiceCommand(root, service),
        ]);
      } else {
        await tmux([
          "respawn-pane",
          "-k",
          "-t",
          `${sessionName}:${service.name}`,
          buildServiceCommand(root, service),
        ]);
      }

      operations.push(operation);
    }
  }

  const status = await readSessionStatus(root, { sessionName });
  return { ...status, operations };
}

export async function stopSession(
  root: string,
  options: Pick<SessionOptions, "sessionName"> = {},
): Promise<{ sessionName: string; stopped: boolean }> {
  const sessionName = options.sessionName ?? DEFAULT_SESSION_NAME;
  if (!(await hasSession(sessionName))) {
    return { sessionName, stopped: false };
  }

  await tmux(["kill-session", "-t", sessionName], { cwd: root });
  return { sessionName, stopped: true };
}

export async function attachSession(
  root: string,
  options: Pick<SessionOptions, "sessionName"> = {},
): Promise<void> {
  const sessionName = options.sessionName ?? DEFAULT_SESSION_NAME;
  if (!(await hasSession(sessionName))) {
    throw new Error(`tmux session not found: ${sessionName}`);
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn("tmux", ["attach-session", "-t", sessionName], {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`tmux attach-session exited with code ${String(code)}`));
    });
  });
}
