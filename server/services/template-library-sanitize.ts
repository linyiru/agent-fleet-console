import fs from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "../lib/env-file.ts";
import { removeSharedMemoryBlock } from "./shared-memory-config.ts";

const GENERATED_WORKSPACE_DIRS = new Set(["node_modules", ".git", ".cache", "dist", "build", "logs"]);
const SECRET_DIRS = new Set([
  ".aws",
  ".azure",
  ".codex",
  ".docker",
  ".gcloud",
  ".gnupg",
  ".ssh",
  "credentials",
  "secrets",
  "tokens",
]);
const SECRET_FILES = new Set([
  ".env",
  "auth.json",
  "credentials.json",
  "global-credentials.env",
]);

function isTemplateSecretLikeName(name: string) {
  const lower = name.toLowerCase();
  return SECRET_FILES.has(lower)
    || /\.env$/i.test(name)
    || /\.(key|pem|p12|pfx)$/i.test(name)
    || /credential|secret|token|password/i.test(name);
}

function shouldSkipTemplateEntry(name: string, workspace: boolean, directory: boolean) {
  const lower = name.toLowerCase();
  if (workspace && directory && GENERATED_WORKSPACE_DIRS.has(name)) return true;
  if (directory && SECRET_DIRS.has(lower)) return true;
  if (!directory && isTemplateSecretLikeName(name)) return true;
  return false;
}

export function sanitizeTemplateConfig(text: string) {
  return removeSharedMemoryBlock(text);
}

export async function copySanitizedTemplateTree(source: string, target: string, options: { workspace?: boolean } = {}) {
  let entries: any[] = [];
  try {
    entries = await fs.readdir(source, { withFileTypes: true });
  } catch {
    return;
  }
  await fs.mkdir(target, { recursive: true });
  for (const entry of entries) {
    if (shouldSkipTemplateEntry(entry.name, Boolean(options.workspace), entry.isDirectory())) continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copySanitizedTemplateTree(from, to, options);
    } else if (entry.isFile()) {
      if (!options.workspace && entry.name === "config.yaml") {
        await fs.writeFile(to, sanitizeTemplateConfig(await fs.readFile(from, "utf8")));
      } else {
        await fs.copyFile(from, to);
      }
    }
  }
}

export function templateRequiredEnvKeys(envText: string) {
  const env = parseEnv(envText);
  const keys = new Set<string>();
  for (const key of Object.keys(env)) {
    if (/TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL|AUTH/i.test(key)) keys.add(key);
  }
  if (env.TELEGRAM_BOT_TOKEN) {
    keys.add("TELEGRAM_BOT_TOKEN");
    if (env.TELEGRAM_ALLOWED_USERS) keys.add("TELEGRAM_ALLOWED_USERS");
    if (env.TELEGRAM_HOME_CHANNEL) keys.add("TELEGRAM_HOME_CHANNEL");
  }
  return [...keys].sort();
}
