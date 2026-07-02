import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_PROVIDER_CONFIG } from "../catalog.ts";
import { GLOBAL_CREDENTIALS_FILE, GLOBAL_OAUTH_DIR, GLOBAL_PROVIDER_FILE, GLOBAL_SYNC_FILE } from "../config.ts";
import { fileExists, parseEnv, readTextIfExists, setEnvValue, deleteEnvValue, writePrivateFile } from "../lib/env-file.ts";
import { applyProviderConfigToFile } from "./templates.ts";
import { homeDir, workspaceDir } from "./compose.ts";
import { applyCodexCliAuthToInstance, applyGlobalOAuthToInstance, oauthSummaries } from "./oauth.ts";

function credentialSummary(key: string, value: string) {
  return {
    key,
    redacted: value ? `${value.slice(0, 2)}...${value.slice(-2)}` : "",
    sensitive: /TOKEN|SECRET|KEY|PASSWORD/i.test(key),
  };
}

async function globalProviderConfig() {
  try {
    return JSON.parse(await fs.readFile(GLOBAL_PROVIDER_FILE, "utf8"));
  } catch {
    return null;
  }
}

async function globalSyncMeta() {
  try {
    return JSON.parse(await fs.readFile(GLOBAL_SYNC_FILE, "utf8"));
  } catch {
    return {};
  }
}

async function fileMtimeIso(file: string) {
  try {
    return (await fs.stat(file)).mtime.toISOString();
  } catch {
    return "";
  }
}

function timeMs(value = "") {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestIso(values: string[]) {
  return values.filter(Boolean).sort((a, b) => timeMs(b) - timeMs(a))[0] || "";
}

export async function globalConfig() {
  const credentials = parseEnv(await readTextIfExists(GLOBAL_CREDENTIALS_FILE));
  const [provider, oauthCredentials, syncMeta, providerChangedAt, credentialsChangedAt] = await Promise.all([
    globalProviderConfig(),
    oauthSummaries(),
    globalSyncMeta(),
    fileMtimeIso(GLOBAL_PROVIDER_FILE),
    fileMtimeIso(GLOBAL_CREDENTIALS_FILE),
  ]);
  const lastSyncedAt = String(syncMeta.syncedAt || "");
  const changedAt = latestIso([
    providerChangedAt,
    credentialsChangedAt,
    ...oauthCredentials.map((item: any) => String(item.savedAt || "")),
  ]);
  return {
    provider,
    credentials: Object.entries(credentials).map(([key, value]) => credentialSummary(key, value)),
    oauthCredentials: oauthCredentials.map((item: any) => {
      const synced = Boolean(item.savedAt && lastSyncedAt && timeMs(lastSyncedAt) >= timeMs(item.savedAt));
      return { ...item, synced, syncedAt: synced ? lastSyncedAt : "" };
    }),
    credentialsFile: GLOBAL_CREDENTIALS_FILE,
    providerFile: GLOBAL_PROVIDER_FILE,
    lastSyncedAt,
    requiresSync: Boolean(changedAt && (!lastSyncedAt || timeMs(lastSyncedAt) < timeMs(changedAt))),
  };
}

export async function writeGlobalProvider(providerConfig: any) {
  const customEndpoints = Array.isArray(providerConfig.customEndpoints)
    ? [...new Set(providerConfig.customEndpoints.map((item: unknown) => String(item || "").trim()).filter(Boolean))]
    : [];
  const provider = {
    provider: providerConfig.provider || DEFAULT_PROVIDER_CONFIG.provider,
    model: providerConfig.model || DEFAULT_PROVIDER_CONFIG.model,
    baseUrl: typeof providerConfig.baseUrl === "string" ? providerConfig.baseUrl : DEFAULT_PROVIDER_CONFIG.baseUrl,
    customEndpoints,
  };
  await writePrivateFile(GLOBAL_PROVIDER_FILE, JSON.stringify(provider, null, 2));
  return provider;
}

export async function setGlobalCredential(key: string, value: string) {
  await setEnvValue(GLOBAL_CREDENTIALS_FILE, key, value);
}

export async function deleteGlobalCredential(key: string) {
  await deleteEnvValue(GLOBAL_CREDENTIALS_FILE, key);
}

export async function applyGlobalConfigToInstance(name: string) {
  const credentials = parseEnv(await readTextIfExists(GLOBAL_CREDENTIALS_FILE));
  for (const [key, value] of Object.entries(credentials)) {
    await setEnvValue(path.join(homeDir(name), ".env"), key, value);
  }
  const provider = await globalProviderConfig();
  if (provider) await applyProviderConfigToFile(path.join(homeDir(name), "config.yaml"), provider);
  const oauth = await applyGlobalOAuthToInstance(name);
  const codexCliConfigured = await fileExists(path.join(workspaceDir(name), "HERMES_CODEX_CLI.md"))
    || await fileExists(path.join(homeDir(name), ".codex", "auth.json"));
  const codexCliAuth = codexCliConfigured ? await applyCodexCliAuthToInstance(name) : { codexCliAuthApplied: false };
  return { credentialCount: Object.keys(credentials).length, providerApplied: Boolean(provider), ...oauth, ...codexCliAuth };
}

export async function syncGlobalConfigToInstances(names: string[], options: { recordFullSync?: boolean } = {}) {
  const synced = [];
  for (const name of names) {
    synced.push({ instance: name, ...await applyGlobalConfigToInstance(name) });
  }
  if (options.recordFullSync !== false) {
    await writePrivateFile(GLOBAL_SYNC_FILE, JSON.stringify({
      syncedAt: new Date().toISOString(),
      agentCount: synced.length,
      oauthCredentialCount: synced.reduce((total, item: any) => total + Number(item.oauthCredentialCount || 0), 0),
    }, null, 2));
  }
  return synced;
}

export async function exportGlobalConfigBundle() {
  const oauthFiles = [];
  try {
    for (const entry of await fs.readdir(GLOBAL_OAUTH_DIR, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      oauthFiles.push({ file: entry.name, content: await fs.readFile(path.join(GLOBAL_OAUTH_DIR, entry.name), "utf8") });
    }
  } catch {
    // No OAuth credentials have been saved yet.
  }
  return {
    providerJson: await readTextIfExists(GLOBAL_PROVIDER_FILE),
    credentialsEnv: await readTextIfExists(GLOBAL_CREDENTIALS_FILE),
    oauthFiles,
  };
}

export async function importGlobalConfigBundle(bundle: any) {
  if (typeof bundle?.providerJson === "string" && bundle.providerJson.trim()) {
    JSON.parse(bundle.providerJson);
    await writePrivateFile(GLOBAL_PROVIDER_FILE, bundle.providerJson);
  }
  if (typeof bundle?.credentialsEnv === "string") await writePrivateFile(GLOBAL_CREDENTIALS_FILE, bundle.credentialsEnv);
  if (Array.isArray(bundle?.oauthFiles)) {
    for (const item of bundle.oauthFiles) {
      const file = String(item?.file || "");
      if (!/^[A-Za-z0-9_.-]+\.json$/.test(file)) continue;
      if (typeof item?.content !== "string") continue;
      JSON.parse(item.content);
      await writePrivateFile(path.join(GLOBAL_OAUTH_DIR, file), item.content);
    }
  }
  return globalConfig();
}
