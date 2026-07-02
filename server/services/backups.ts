import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { GLOBAL_CREDENTIALS_FILE, GLOBAL_PROVIDER_FILE, HERMES_DOCKER } from "../config.ts";
import { run } from "../lib/process.ts";
import { readTextIfExists, writePrivateFile } from "../lib/env-file.ts";
import { copyTree, createArchive, extractArchive, archiveManifest, BACKUP_DIR, ensureBackupDir, readJson, safeArchivePath, tempDir, timestampedArchiveName, writeJson } from "./backup-files.ts";
import { composeFile, homeDir, instanceDir, workspaceDir } from "./compose.ts";
import { discoverInstanceNames, instanceSnapshot, runManager } from "./instances.ts";
import { allocateInstancePorts } from "./ports.ts";
import { recordEvent } from "./records.ts";
import { writeWebInstructions } from "./web-hosting.ts";
import os from "node:os";

type ExportOptions = { scope: string; names: string[]; includeSecrets: boolean; includeWorkspace: boolean };
type RestoreOptions = { archivePath: string; namePrefix: string; restoreGlobalConfig: boolean; restoreSecrets: boolean; startRestored: boolean };
type CloneOptions = { newName: string; copyWorkspace: boolean; copyCredentials: boolean; start: boolean };

function importedArchiveName(originalFile = "") {
  const base = path.basename(originalFile || "archive.tar.gz")
    .replace(/[^A-Za-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const archiveBase = base.endsWith(".tar.gz") ? base : "archive.tar.gz";
  return `hermes-import-${new Date().toISOString().replace(/[:.]/g, "-")}-${archiveBase}`;
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

async function archiveStats(file: string) {
  const stat = await fs.stat(file);
  return { file: path.basename(file), path: file, size: stat.size, createdAt: stat.birthtime.toISOString(), modifiedAt: stat.mtime.toISOString() };
}

export async function listBackups() {
  await ensureBackupDir();
  const files = (await fs.readdir(BACKUP_DIR)).filter((file) => file.endsWith(".tar.gz"));
  return Promise.all(files.map((file) => archiveStats(path.join(BACKUP_DIR, file))));
}

export async function importBackup(readable: NodeJS.ReadableStream, originalFile = "") {
  await ensureBackupDir();
  const file = importedArchiveName(originalFile);
  const archive = safeArchivePath(file);
  try {
    await pipeline(readable, fsSync.createWriteStream(archive, { mode: 0o600 }));
    const manifest = await archiveManifest(archive);
    return { archive: await archiveStats(archive), manifest };
  } catch (error) {
    await fs.rm(archive, { force: true });
    throw error;
  }
}

function globalManifest(includeSecrets: boolean) {
  return { provider: true, credentials: includeSecrets && true };
}

async function stageGlobal(stage: string, includeSecrets: boolean) {
  const globalDir = path.join(stage, "global");
  await fs.mkdir(globalDir, { recursive: true });
  if (await exists(GLOBAL_PROVIDER_FILE)) await fs.copyFile(GLOBAL_PROVIDER_FILE, path.join(globalDir, "provider.json"));
  if (includeSecrets && await exists(GLOBAL_CREDENTIALS_FILE)) await fs.copyFile(GLOBAL_CREDENTIALS_FILE, path.join(globalDir, "credentials.env"));
}

async function stageAgent(stage: string, name: string, includeSecrets: boolean, includeWorkspace: boolean) {
  const snapshot = await instanceSnapshot(name);
  const target = path.join(stage, "agents", name);
  await copyTree(homeDir(name), path.join(target, "home"), { includeSecrets });
  if (includeWorkspace) await copyTree(workspaceDir(name), path.join(target, "workspace"), { includeSecrets, workspace: true });
  return { name, dependencies: snapshot.dependencies || {}, includeWorkspace, copiedSecrets: includeSecrets };
}

export async function exportBackup(options: ExportOptions) {
  const names = options.scope === "fleet" ? await discoverInstanceNames() : options.names;
  const stage = await tempDir("hermes-backup-");
  const archive = safeArchivePath(timestampedArchiveName(options.scope));
  const agents = [];
  for (const name of names) agents.push(await stageAgent(stage, name, options.includeSecrets, options.includeWorkspace));
  await stageGlobal(stage, options.includeSecrets);
  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    scope: options.scope,
    includeSecrets: options.includeSecrets,
    includeWorkspace: options.includeWorkspace,
    global: globalManifest(options.includeSecrets),
    agents,
  };
  await writeJson(path.join(stage, "manifest.json"), manifest);
  await createArchive(stage, archive);
  await fs.rm(stage, { recursive: true, force: true });
  return { archive: await archiveStats(archive), manifest };
}

function targetName(name: string, prefix: string) {
  return prefix ? `${prefix}${name}` : name;
}

export async function inspectBackup(archivePath: string) {
  const manifest = await archiveManifest(path.resolve(archivePath));
  const existing = new Set(await discoverInstanceNames());
  const conflicts = (manifest.agents || []).map((agent: any) => agent.name).filter((name: string) => existing.has(name));
  return { manifest, conflicts };
}

export async function deployFresh(name: string, dependencies: any) {
  const ports = await allocateInstancePorts(dependencies?.camofox !== false);
  const args = ["deploy", name, "--dashboard-port", String(ports.dashboard), "--health-port", String(ports.health), "--web-port", String(ports.web)];
  if (ports.vnc) args.push("--vnc-port", String(ports.vnc));
  if (dependencies?.camofox === false) args.push("--without-camofox");
  await run(HERMES_DOCKER, args, { timeout: 30 * 60 * 1000, maxBuffer: 1024 * 1024 * 8 });
}

async function restoreGlobal(extracted: string, options: RestoreOptions) {
  if (!options.restoreGlobalConfig) return {};
  const providerFile = path.join(extracted, "global", "provider.json");
  const credentialsFile = path.join(extracted, "global", "credentials.env");
  if (await exists(providerFile)) await writePrivateFile(GLOBAL_PROVIDER_FILE, await readTextIfExists(providerFile));
  if (options.restoreSecrets && await exists(credentialsFile)) await writePrivateFile(GLOBAL_CREDENTIALS_FILE, await readTextIfExists(credentialsFile));
  return { providerRestored: await exists(providerFile), credentialsRestored: options.restoreSecrets && await exists(credentialsFile) };
}

export async function restoreBackup(options: RestoreOptions) {
  const archive = path.resolve(options.archivePath);
  const extracted = await tempDir("hermes-restore-");
  await extractArchive(archive, extracted);
  const manifest = await readJson(path.join(extracted, "manifest.json"));
  const existing = new Set(await discoverInstanceNames());
  const conflicts = (manifest.agents || []).filter((agent: any) => existing.has(targetName(agent.name, options.namePrefix)));
  if (conflicts.length) throw new Error(`Restore conflicts: ${conflicts.map((agent: any) => targetName(agent.name, options.namePrefix)).join(", ")}`);
  const restored = [];
  for (const agent of manifest.agents || []) {
    const name = targetName(agent.name, options.namePrefix);
    await deployFresh(name, agent.dependencies || {});
    await copyTree(path.join(extracted, "agents", agent.name, "home"), homeDir(name), { includeSecrets: options.restoreSecrets });
    await copyTree(path.join(extracted, "agents", agent.name, "workspace"), workspaceDir(name), { includeSecrets: options.restoreSecrets, workspace: true });
    await writeWebInstructions(name, lanAddress());
    if (options.startRestored) await runManager(["start", name], 120000);
    recordEvent(name, "backup_restored", `Restored from ${path.basename(archive)}`, { source: agent.name });
    restored.push(name);
  }
  const global = await restoreGlobal(extracted, options);
  await fs.rm(extracted, { recursive: true, force: true });
  return { restored, global };
}

export async function cloneInstance(source: string, options: CloneOptions) {
  if (!await exists(composeFile(source))) throw new Error("Source agent not found");
  if (await exists(instanceDir(options.newName))) throw new Error("Target agent already exists");
  const sourceSnapshot = await instanceSnapshot(source);
  await deployFresh(options.newName, sourceSnapshot.dependencies || {});
  await copyTree(homeDir(source), homeDir(options.newName), { includeSecrets: options.copyCredentials });
  if (options.copyWorkspace) await copyTree(workspaceDir(source), workspaceDir(options.newName), { includeSecrets: options.copyCredentials, workspace: true });
  await writeWebInstructions(options.newName, lanAddress());
  if (options.start) await runManager(["start", options.newName], 120000);
  recordEvent(options.newName, "agent_cloned", `Cloned from ${source}`, { source, copyWorkspace: options.copyWorkspace, copyCredentials: options.copyCredentials });
  return { source, target: options.newName };
}
