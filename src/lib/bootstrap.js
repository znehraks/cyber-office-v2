import fs from "node:fs/promises";
import path from "node:path";

import {
  ROLE_REGISTRY,
  LEGACY_SPECIALIST_ROLES,
  ALLOWED_HIGH_ROLES,
  ROUTING_RULES,
} from "./roles.js";
import { ensureRuntimeLayout, readJson, runtimePath, writeJson } from "./runtime.js";

const LEGACY_HOME = process.env.CO_LEGACY_HOME ?? "/Users/designc/Documents/cyber-office";

function buildPrompt(role) {
  return [
    `# ${role.name}`,
    "",
    `Role: ${role.description}`,
    "",
    "Hard rules:",
    "- Discord ingress는 읽지 않는다. packet + artifact path만 입력으로 사용한다.",
    "- packet.required_refs 가 모두 존재하지 않으면 작업을 시작하지 않는다.",
    "- 산출물은 오직 runtime/artifacts/<job_id>/ 아래에만 쓴다.",
    "- 최소 필수 산출물은 summary.md 이다.",
    "- handoff가 필요하면 handoff.json을 만든다.",
    "- closeout 문서를 직접 완결할 때는 STATUS.md, NEXT-STEPS.md, closeout.json 규약을 따른다.",
    "- tier는 내부적으로만 사용된다. 외부 보고에는 role / tier만 노출한다.",
  ].join("\n");
}

async function buildMcpConfig(role) {
  const sourceRole = role.sourceRole;
  const legacyPath = path.join(LEGACY_HOME, sourceRole, ".mcp.json");
  const legacy = await readJson(legacyPath, { mcpServers: {} });
  const filtered = Object.fromEntries(
    Object.entries(legacy.mcpServers ?? {}).filter(([name]) => name !== "discord-fork"),
  );
  return { mcpServers: filtered };
}

function buildSettings(role) {
  return {
    role: role.name,
    source_role: role.sourceRole,
    model: role.model,
    tier: role.tier,
    effort: role.effort,
    allowed_tools: [],
    notes: role.description,
  };
}

async function writeText(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${value}\n`, "utf8");
}

export async function bootstrapRuntimeWorkers(root) {
  await ensureRuntimeLayout(root);

  const registry = {
    legacy_roles: LEGACY_SPECIALIST_ROLES,
    allowed_high_roles: ALLOWED_HIGH_ROLES,
    routing_rules: ROUTING_RULES,
    roles: ROLE_REGISTRY,
  };
  await writeJson(path.join(root, "role-registry.json"), registry);

  for (const role of ROLE_REGISTRY) {
    const roleDir = runtimePath(root, "workers", role.name);
    await fs.mkdir(roleDir, { recursive: true });
    await writeText(path.join(roleDir, "prompt.txt"), buildPrompt(role));
    await writeJson(path.join(roleDir, "settings.json"), buildSettings(role));
    await writeJson(path.join(roleDir, "mcp.json"), await buildMcpConfig(role));
  }

  return registry;
}
