import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as process from "node:process";

import type {
  ProjectRef,
  ProjectRegistryEntry,
  ProjectRegistryFile,
} from "../types/domain.js";
import { parseProjectRegistryFile } from "../types/domain.js";
import { readJson, writeJson } from "./runtime.js";

const DEFAULT_PROJECT_REGISTRY: ProjectRegistryFile = {
  projects: [],
};

export function projectRegistryFile(root: string): string {
  return path.join(root, "project-registry.json");
}

export async function readProjectRegistry(
  root: string,
): Promise<ProjectRegistryFile> {
  return readJson(
    projectRegistryFile(root),
    parseProjectRegistryFile,
    DEFAULT_PROJECT_REGISTRY,
  );
}

export async function writeProjectRegistry(
  root: string,
  registry: ProjectRegistryFile,
): Promise<ProjectRegistryFile> {
  await writeJson(projectRegistryFile(root), registry);
  return registry;
}

export function resolveObsidianProjectsRoot(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const root = env["CO_OBSIDIAN_PROJECTS_ROOT"] ?? "";
  if (root === "") {
    throw new Error("CO_OBSIDIAN_PROJECTS_ROOT is required");
  }
  return root;
}

export function resolveProjectRef(
  entry: ProjectRegistryEntry,
  env: NodeJS.ProcessEnv = process.env,
): ProjectRef {
  return {
    ...entry,
    obsidian_project_dir: path.join(
      resolveObsidianProjectsRoot(env),
      entry.obsidian_rel_dir,
    ),
  };
}

export async function resolveProjectByChannelId(
  root: string,
  channelId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProjectRef | null> {
  const registry = await readProjectRegistry(root);
  const match = registry.projects.find(
    (project) => project.discord_channel_id === channelId,
  );
  return match ? resolveProjectRef(match, env) : null;
}

export async function resolveProjectBySlug(
  root: string,
  projectSlug: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProjectRef | null> {
  const registry = await readProjectRegistry(root);
  const match = registry.projects.find(
    (project) => project.project_slug === projectSlug,
  );
  return match ? resolveProjectRef(match, env) : null;
}

export async function validateProjectRegistry(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProjectRegistryFile> {
  const registry = await readProjectRegistry(root);
  const channelIds = new Set<string>();

  for (const project of registry.projects) {
    if (channelIds.has(project.discord_channel_id)) {
      throw new Error(
        `Duplicate project discord_channel_id: ${project.discord_channel_id}`,
      );
    }
    channelIds.add(project.discord_channel_id);

    const projectRef = resolveProjectRef(project, env);
    try {
      const stats = await fs.stat(projectRef.obsidian_project_dir);
      if (!stats.isDirectory()) {
        throw new Error(
          `Project Obsidian path missing: ${projectRef.obsidian_project_dir}`,
        );
      }
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(
          `Project Obsidian path missing: ${projectRef.obsidian_project_dir}`,
        );
      }
      throw error;
    }
  }

  return registry;
}

export function projectOperationsDir(projectRef: ProjectRef): string {
  return path.join(projectRef.obsidian_project_dir, "_cyber-office");
}

export function epicNotesDir(projectRef: ProjectRef, epicSlug: string): string {
  return path.join(projectOperationsDir(projectRef), "epics", epicSlug);
}

export function epicNotePath(projectRef: ProjectRef, epicSlug: string): string {
  return path.join(epicNotesDir(projectRef, epicSlug), "EPIC.md");
}

export function missionNotePath(
  projectRef: ProjectRef,
  epicSlug: string,
  missionId: string,
): string {
  return path.join(
    epicNotesDir(projectRef, epicSlug),
    "missions",
    `${missionId}.md`,
  );
}

export function missionDeliverablesDir(
  projectRef: ProjectRef,
  epicSlug: string,
  missionId: string,
): string {
  return path.join(
    epicNotesDir(projectRef, epicSlug),
    "deliverables",
    missionId,
  );
}

export function missionDeliverablePath(
  projectRef: ProjectRef,
  epicSlug: string,
  missionId: string,
  fileName: string,
): string {
  return path.join(
    missionDeliverablesDir(projectRef, epicSlug, missionId),
    fileName,
  );
}

export async function ensureLocalProjectRef(
  root: string,
  projectSlug = "cyber-office-runtime",
): Promise<ProjectRef> {
  const projectDir = path.join(
    root,
    "runtime",
    "state",
    "local-projects",
    projectSlug,
  );
  await fs.mkdir(projectDir, { recursive: true });
  return {
    project_slug: projectSlug,
    display_name: projectSlug,
    discord_channel_id: "local-channel",
    obsidian_rel_dir: projectSlug,
    obsidian_project_dir: projectDir,
  };
}
