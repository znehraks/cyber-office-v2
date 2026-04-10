import path from "node:path";
import { spawn } from "node:child_process";

export const DEFAULT_SESSION_NAME = process.env.CO_TMUX_SESSION ?? "cyber-office-v2";
export const LEGACY_LAUNCHD_LABELS = [
  "com.znehraks.cyber-office-v2.ceo",
  "com.znehraks.cyber-office-v2.god",
  "com.znehraks.cyber-office-v2.supervisor",
];

export const SERVICE_DEFINITIONS = [
  { name: "ceo", script: "scripts/run-discord-ceo.sh" },
  { name: "god", script: "scripts/run-discord-god.sh" },
  { name: "supervisor", script: "scripts/run-supervisor-daemon.sh" },
];

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function tmux(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("tmux", args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
        return;
      }
      const error = new Error(stderr.trim() || `tmux exited with code ${code}`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

function runCaptured(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function hasSession(sessionName) {
  try {
    await tmux(["has-session", "-t", sessionName]);
    return true;
  } catch {
    return false;
  }
}

export function buildServiceCommand(root, service) {
  const shellCommand = [
    `cd ${shellEscape(root)}`,
    `exec ${shellEscape(path.join(root, service.script))}`,
  ].join(" && ");
  return `exec bash -lc ${shellEscape(shellCommand)}`;
}

export function parseTmuxWindowRows(output) {
  return String(output ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, dead, pid, command] = line.split("\t");
      return {
        name,
        dead: dead === "1",
        pid: Number(pid),
        command,
      };
    });
}

export function planSessionOperations(windows) {
  const byName = new Map(windows.map((window) => [window.name, window]));
  const operations = [];

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

export async function findActiveLegacyServices(options = {}) {
  const inspectLabel =
    options.inspectLabel ??
    (async (label) => {
      const uid = options.uid ?? process.getuid?.();
      if (!uid) {
        return false;
      }
      const result = await runCaptured("launchctl", ["print", `gui/${uid}/${label}`], {
        cwd: options.cwd,
        env: options.env,
      });
      return result.code === 0;
    });

  const active = [];
  for (const label of LEGACY_LAUNCHD_LABELS) {
    if (await inspectLabel(label)) {
      active.push(label);
    }
  }
  return active;
}

export async function assertNoLegacyConflicts(options = {}) {
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

async function listWindows(sessionName) {
  const { stdout } = await tmux([
    "list-windows",
    "-t",
    sessionName,
    "-F",
    "#{window_name}\t#{pane_dead}\t#{pane_pid}\t#{pane_current_command}",
  ]);
  return parseTmuxWindowRows(stdout);
}

function toServiceStatus(windows) {
  const byName = new Map(windows.map((window) => [window.name, window]));
  return SERVICE_DEFINITIONS.map((service) => {
    const window = byName.get(service.name);
    if (!window) {
      return { service: service.name, status: "missing", pid: null, dead: null, command: null };
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

export async function readSessionStatus(root, options = {}) {
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

export async function startSession(root, options = {}) {
  const sessionName = options.sessionName ?? DEFAULT_SESSION_NAME;
  const operations = [];

  if (options.enforceNoLegacy !== false) {
    await assertNoLegacyConflicts(options);
  }

  if (!(await hasSession(sessionName))) {
    const [firstService, ...rest] = SERVICE_DEFINITIONS;
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
      const service = SERVICE_DEFINITIONS.find((item) => item.name === operation.service);
      if (!service) continue;

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
      } else if (operation.type === "respawn_window") {
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

  return {
    ...(await readSessionStatus(root, { sessionName })),
    operations,
  };
}

export async function stopSession(root, options = {}) {
  const sessionName = options.sessionName ?? DEFAULT_SESSION_NAME;
  if (!(await hasSession(sessionName))) {
    return { sessionName, stopped: false };
  }

  await tmux(["kill-session", "-t", sessionName], { cwd: root });
  return { sessionName, stopped: true };
}

export async function attachSession(root, options = {}) {
  const sessionName = options.sessionName ?? DEFAULT_SESSION_NAME;
  if (!(await hasSession(sessionName))) {
    throw new Error(`tmux session not found: ${sessionName}`);
  }

  await new Promise((resolve, reject) => {
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
      reject(new Error(`tmux attach-session exited with code ${code}`));
    });
  });
}
