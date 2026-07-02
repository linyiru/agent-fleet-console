import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DATA_DIR } from "../config.ts";
import { run } from "../lib/process.ts";

export const BACKUP_DIR = path.join(DATA_DIR, "backups");
const SKIP_DIRS = new Set(["node_modules", ".git", ".cache", "dist", "build", "logs"]);
const SECRET_FILES = new Set([".env", "global-credentials.env"]);

export async function ensureBackupDir() {
  await fs.mkdir(BACKUP_DIR, { recursive: true, mode: 0o700 });
}

export function safeArchivePath(file: string) {
  return path.join(BACKUP_DIR, file);
}

export function timestampedArchiveName(scope: string) {
  return `hermes-${scope}-${new Date().toISOString().replace(/[:.]/g, "-")}.tar.gz`;
}

export async function tempDir(prefix: string) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function secretLike(name: string) {
  return SECRET_FILES.has(name) || /\.env$/i.test(name) || /\.(key|pem|p12)$/i.test(name) || /credential|secret|token/i.test(name);
}

function shouldSkip(name: string, includeSecrets: boolean, workspace: boolean) {
  if (workspace && SKIP_DIRS.has(name)) return true;
  if (!includeSecrets && secretLike(name)) return true;
  return false;
}

export async function copyTree(source: string, target: string, options: { includeSecrets: boolean; workspace?: boolean }) {
  let entries: any[] = [];
  try {
    entries = await fs.readdir(source, { withFileTypes: true });
  } catch {
    return;
  }
  await fs.mkdir(target, { recursive: true });
  for (const entry of entries) {
    if (shouldSkip(entry.name, options.includeSecrets, Boolean(options.workspace))) continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) await copyTree(from, to, options);
    else if (entry.isFile()) await fs.copyFile(from, to);
  }
}

export async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJson(file: string) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

export async function createArchive(stageDir: string, archivePath: string) {
  await ensureBackupDir();
  await fs.mkdir(path.dirname(archivePath), { recursive: true, mode: 0o700 });
  await run("tar", ["-czf", archivePath, "-C", stageDir, "."], { timeout: 120000, maxBuffer: 1024 * 1024 * 8 });
}

function validateTarMemberName(rawName: string) {
  const name = rawName.replace(/^\.\/+/, "");
  if (!name || name === ".") return;
  if (name.includes("\0") || path.isAbsolute(name) || name === ".." || name.startsWith("../") || name.includes("/../") || name.endsWith("/..")) {
    throw new Error(`Unsafe backup archive member: ${rawName}`);
  }
}

async function validateArchiveMembers(archivePath: string) {
  const [names, verbose] = await Promise.all([
    run("tar", ["-tzf", archivePath], { timeout: 30000, maxBuffer: 1024 * 1024 * 8 }),
    run("tar", ["-tvzf", archivePath], { timeout: 30000, maxBuffer: 1024 * 1024 * 8 }),
  ]);
  for (const line of verbose.stdout.split(/\r?\n/).filter(Boolean)) {
    const type = line[0];
    if (type === "l" || type === "h") throw new Error(`Unsafe backup archive link entry: ${line}`);
  }
  for (const name of names.stdout.split(/\r?\n/).filter(Boolean)) {
    validateTarMemberName(name);
  }
}

export async function extractArchive(archivePath: string, targetDir: string) {
  await validateArchiveMembers(archivePath);
  await run("tar", ["-xzf", archivePath, "-C", targetDir], { timeout: 120000, maxBuffer: 1024 * 1024 * 8 });
}

export async function archiveManifest(archivePath: string) {
  await validateArchiveMembers(archivePath);
  const { stdout } = await run("tar", ["-xOf", archivePath, "./manifest.json"], { timeout: 30000, maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout);
}
