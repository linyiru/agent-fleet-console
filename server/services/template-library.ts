import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, GLOBAL_CREDENTIALS_FILE, validators } from "../config.ts";
import { db } from "../database.ts";
import { parseEnv, readTextIfExists, setEnvValue } from "../lib/env-file.ts";
import { createArchive, extractArchive, readJson, tempDir, writeJson } from "./backup-files.ts";
import { deployFresh } from "./backups.ts";
import { composeFile, homeDir, instanceDir, workspaceDir } from "./compose.ts";
import { applyCreateCapabilities } from "./capabilities.ts";
import { applyGlobalOAuthToInstance, applyCodexCliAuthToInstance } from "./oauth.ts";
import { globalConfig } from "./global-config.ts";
import { instanceSnapshot, runManager } from "./instances.ts";
import { recordEvent, parseJson } from "./records.ts";
import { isSharedMemoryConfig } from "./shared-memory-config.ts";
import { writeWebInstructions } from "./web-hosting.ts";
import { copySanitizedTemplateTree, templateRequiredEnvKeys } from "./template-library-sanitize.ts";
import { checkRemoteTemplateRequirements } from "./template-library-remote.ts";
import { missingFromConfig, unique, type TemplateRequirements } from "./template-library-requirements.ts";
import os from "node:os";

const TEMPLATE_LIBRARY_DIR = path.join(DATA_DIR, "template-library");
export { deployTemplateToRemote } from "./template-library-remote.ts";

type CaptureOptions = {
  sourceName: string;
  sourceNodeId?: string;
  name: string;
  description?: string;
  includeWorkspace?: boolean;
};

type ArchiveDeployOptions = {
  archivePath: string;
  name: string;
  start?: boolean;
  allowMissingRequirements?: boolean;
};

function httpError(message: string, status = 400) {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}

function lanAddress() {
  for (const rows of Object.values(os.networkInterfaces())) {
    for (const row of rows || []) {
      if (row.family === "IPv4" && !row.internal) return row.address;
    }
  }
  return "127.0.0.1";
}

async function exists(file: string) {
  try { await fs.access(file); return true; } catch { return false; }
}

async function templateArchiveStats(file: string) {
  const stat = await fs.stat(file);
  return {
    file: path.basename(file),
    path: file,
    size: stat.size,
    createdAt: stat.birthtime.toISOString(),
    modifiedAt: stat.mtime.toISOString(),
  };
}

function slugifyTemplateId(value: string) {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || `template-${cryptoRandom()}`;
}

function cryptoRandom() {
  return Math.random().toString(36).slice(2, 10);
}

function rowToTemplate(row: any) {
  const manifest = parseJson(row.manifest_json, {});
  const requirements = parseJson(row.requirements_json, {});
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sourceInstance: row.source_instance,
    sourceNodeId: row.source_node_id,
    archive: {
      file: row.archive_file,
      path: row.archive_path,
      size: row.size,
    },
    manifest,
    requirements,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function templateRow(id: string) {
  return db.prepare("SELECT * FROM template_library WHERE id = ?").get(id);
}

export function getTemplateLibraryItem(id: string) {
  const row = templateRow(id);
  return row ? rowToTemplate(row) : null;
}

export async function listTemplateLibrary() {
  await fs.mkdir(TEMPLATE_LIBRARY_DIR, { recursive: true, mode: 0o700 });
  const rows = db.prepare("SELECT * FROM template_library ORDER BY created_at DESC").all();
  return { templates: rows.map(rowToTemplate) };
}

async function templateRequirementsForAgent(name: string, snapshot: any): Promise<TemplateRequirements> {
  const home = homeDir(name);
  const workspace = workspaceDir(name);
  const envText = await readTextIfExists(path.join(home, ".env"));
  const configText = await readTextIfExists(path.join(home, "config.yaml"));
  const configProvider = String(snapshot?.config?.provider || "").trim();
  const codexCli = await exists(path.join(workspace, "HERMES_CODEX_CLI.md")) || await exists(path.join(home, ".codex", "auth.json"));
  const payments = await exists(path.join(workspace, "HERMES_PAYMENTS.md"));
  const sharedMemory = isSharedMemoryConfig(configText) || await exists(path.join(home, "skills", "fleet-shared-memory", "SKILL.md"));
  const env = parseEnv(envText);
  const telegram = Boolean(env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_ENABLED === "true");
  const oauthProviders = new Set<string>();
  if (codexCli || configProvider === "openai-codex") oauthProviders.add("openai-codex");
  return {
    envKeys: templateRequiredEnvKeys(envText),
    oauthProviders: unique([...oauthProviders]),
    capabilities: { codexCli, payments, sharedMemory, telegram },
  };
}

function templateArchiveName(id: string) {
  return `${id}-${new Date().toISOString().replace(/[:.]/g, "-")}.tar.gz`;
}

function templateArchivePath(file: string) {
  return path.join(TEMPLATE_LIBRARY_DIR, path.basename(file));
}

function makeUniqueTemplateId(name: string) {
  const base = slugifyTemplateId(name);
  let id = base;
  let index = 2;
  while (templateRow(id)) {
    id = `${base.slice(0, 56)}-${index}`;
    index += 1;
  }
  return id;
}

export async function captureTemplate(options: CaptureOptions) {
  if (options.sourceNodeId && options.sourceNodeId !== "local") {
    throw httpError("Template capture is currently supported from local Docker agents. Deploy captured templates to any Fleet node.", 400);
  }
  const sourceName = validators.validateName(options.sourceName);
  const title = String(options.name || "").trim().slice(0, 120);
  if (!title) throw httpError("Template name is required", 400);
  if (!await exists(composeFile(sourceName))) throw httpError("Source agent is not a Docker Hermes agent", 400);

  const snapshot = await instanceSnapshot(sourceName);
  if (snapshot.runtime !== "docker") throw httpError("Template capture only supports Docker Hermes agents", 400);

  await fs.mkdir(TEMPLATE_LIBRARY_DIR, { recursive: true, mode: 0o700 });
  const id = makeUniqueTemplateId(title);
  const archiveFile = templateArchiveName(id);
  const archivePath = templateArchivePath(archiveFile);
  const stage = await tempDir("hermes-template-");
  const includeWorkspace = options.includeWorkspace !== false;
  const requirements = await templateRequirementsForAgent(sourceName, snapshot);

  try {
    const agentRoot = path.join(stage, "agents", sourceName);
    await copySanitizedTemplateTree(homeDir(sourceName), path.join(agentRoot, "home"));
    if (includeWorkspace) {
      await copySanitizedTemplateTree(workspaceDir(sourceName), path.join(agentRoot, "workspace"), { workspace: true });
    }
    const manifest = {
      version: 1,
      kind: "agent-template",
      createdAt: new Date().toISOString(),
      includeSecrets: false,
      includeWorkspace,
      global: { provider: false, credentials: false },
      source: {
        name: sourceName,
        displayName: snapshot.displayName || "",
        nodeId: "local",
      },
      template: {
        id,
        name: title,
        description: String(options.description || "").trim().slice(0, 2000),
      },
      requirements,
      agents: [{
        name: sourceName,
        dependencies: snapshot.dependencies || {},
        includeWorkspace,
        copiedSecrets: false,
      }],
    };
    await writeJson(path.join(stage, "manifest.json"), manifest);
    await createArchive(stage, archivePath);
    const stats = await templateArchiveStats(archivePath);
    db.prepare(`
      INSERT INTO template_library (
        id, name, description, source_instance, source_node_id, archive_file, archive_path,
        size, manifest_json, requirements_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      title,
      manifest.template.description,
      sourceName,
      "local",
      stats.file,
      stats.path,
      stats.size,
      JSON.stringify(manifest),
      JSON.stringify(requirements),
      manifest.createdAt,
      manifest.createdAt,
    );
    recordEvent(sourceName, "template_captured", `Saved ${title} to template library`, { templateId: id });
    return { template: getTemplateLibraryItem(id), manifest, archive: stats };
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}

export async function deleteTemplate(id: string) {
  const template = getTemplateLibraryItem(validators.validateTemplateId(id));
  if (!template) throw httpError("Template not found", 404);
  db.prepare("DELETE FROM template_library WHERE id = ?").run(template.id);
  await fs.rm(template.archive.path, { force: true });
  return { ok: true };
}

export async function checkLocalTemplateRequirements(requirements: TemplateRequirements = {}) {
  return missingFromConfig(requirements, await globalConfig());
}

export async function checkTemplateRequirementsForTarget(id: string, targetNodeId = "local") {
  const template = getTemplateLibraryItem(validators.validateTemplateId(id));
  if (!template) throw httpError("Template not found", 404);
  if (targetNodeId === "local") return checkLocalTemplateRequirements(template.requirements);
  return checkRemoteTemplateRequirements(targetNodeId, template.requirements);
}

async function applyRequiredCredentials(name: string, requirements: TemplateRequirements = {}) {
  const credentials = parseEnv(await readTextIfExists(GLOBAL_CREDENTIALS_FILE));
  let applied = 0;
  for (const key of unique(requirements.envKeys || [])) {
    if (!credentials[key]) continue;
    await setEnvValue(path.join(homeDir(name), ".env"), key, credentials[key]);
    applied += 1;
  }
  return applied;
}

function capabilityFlags(requirements: TemplateRequirements = {}, check: { missing: Array<{ type: string; key: string }> }, startRestored: boolean) {
  const missing = new Set(check.missing.map((item) => `${item.type}:${item.key}`));
  const caps = requirements.capabilities || {};
  return {
    sharedMemory: caps.sharedMemory === true,
    codexCli: startRestored && caps.codexCli === true && !missing.has("oauth:openai-codex"),
    payments: startRestored && caps.payments === true,
  };
}

export async function runTemplateDeploy(options: ArchiveDeployOptions) {
  const archive = path.resolve(options.archivePath);
  const target = validators.validateName(options.name);
  const extracted = await tempDir("hermes-template-deploy-");
  try {
    await extractArchive(archive, extracted);
    const manifest = await readJson(path.join(extracted, "manifest.json"));
    if (manifest.kind !== "agent-template") throw httpError("Archive is not an agent template", 400);
    const agent = (manifest.agents || [])[0];
    if (!agent?.name || (manifest.agents || []).length !== 1) throw httpError("Template archives must contain exactly one agent", 400);
    if (await exists(instanceDir(target))) throw httpError(`Target agent already exists: ${target}`, 409);

    const requirements = manifest.requirements || {};
    const check = await checkLocalTemplateRequirements(requirements);
    if (!check.ok && !options.allowMissingRequirements) {
      const error = httpError("Template requirements are missing on this node", 409) as Error & { details?: any };
      error.details = check;
      throw error;
    }

    await deployFresh(target, agent.dependencies || {});
    await copySanitizedTemplateTree(path.join(extracted, "agents", agent.name, "home"), homeDir(target));
    await copySanitizedTemplateTree(path.join(extracted, "agents", agent.name, "workspace"), workspaceDir(target), { workspace: true });
    await writeWebInstructions(target, lanAddress());
    const credentialCount = await applyRequiredCredentials(target, requirements);
    if ((requirements.oauthProviders || []).includes("openai-codex")) {
      await applyGlobalOAuthToInstance(target);
      await applyCodexCliAuthToInstance(target);
    }
    const shared = capabilityFlags(requirements, check, Boolean(options.start !== false));
    if (shared.sharedMemory) await applyCreateCapabilities(target, { sharedMemory: true }, "docker");
    if (options.start !== false) await runManager(["start", target], 120000);
    const postStart = {
      codexCli: shared.codexCli,
      payments: shared.payments,
    };
    const capabilityResult = (postStart.codexCli || postStart.payments)
      ? await applyCreateCapabilities(target, postStart, "docker")
      : {};
    recordEvent(target, "template_deployed", `Deployed from template ${manifest.template?.name || manifest.template?.id || path.basename(archive)}`, {
      templateId: manifest.template?.id || "",
      source: agent.name,
      missingRequirements: check.missing,
    });
    return {
      instance: target,
      source: agent.name,
      template: manifest.template || null,
      requirements: check,
      credentialCount,
      capabilities: { sharedMemory: shared.sharedMemory, ...capabilityResult },
    };
  } finally {
    await fs.rm(extracted, { recursive: true, force: true });
  }
}
