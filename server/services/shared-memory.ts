import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, ROOT } from "../config.ts";
import { parseEnv, readTextIfExists, writePrivateFile } from "../lib/env-file.ts";
import { jobErrorText, run } from "../lib/process.ts";
import { homeDir } from "./compose.ts";
import { discoverInstanceNames, instanceSnapshot, runManager } from "./instances.ts";
import { ADD_SCRIPT, CONTAINER_DB_PATH, DELETE_SCRIPT, HUB_LAUNCHER, LIST_SCRIPT, SEARCH_SCRIPT, skillMarkdown } from "./shared-memory-assets.ts";
import {
  isSharedMemoryConfig,
  removeSharedMemoryBlock,
  sharedMemoryConfigBlock,
  upsertSharedMemoryBlock,
} from "./shared-memory-config.ts";

const HUB_CONTAINER = "hermes-shared-memory-hub";
const HUB_INTERNAL_PORT = 8377;
const SHARED_DIR = path.join(DATA_DIR, "shared-memory");
const HUB_ENV_FILE = path.join(SHARED_DIR, "hub.env");
const HUB_LAUNCHER_FILE = path.join(SHARED_DIR, "hub-launcher.py");
const DB_DIR = path.join(SHARED_DIR, "db");
const CACHE_DIR = path.join(SHARED_DIR, "cache");
const CONTAINER_PYTHON = "/opt/hermes/.venv/bin/python";
const SKILL_DIR_NAME = "fleet-shared-memory";
const ENTRY_KINDS = ["meta", "preference", "correction", "identity"];

type HubSettings = { token: string; port: number };

async function hubSettings(): Promise<HubSettings> {
  await fs.mkdir(DB_DIR, { recursive: true, mode: 0o700 });
  await fs.mkdir(CACHE_DIR, { recursive: true, mode: 0o700 });
  const current = parseEnv(await readTextIfExists(HUB_ENV_FILE));
  const token = current.MNEMOSYNE_MCP_TOKEN || crypto.randomBytes(24).toString("base64url");
  const port = Number(current.HERMES_SHARED_MEMORY_PORT || process.env.HERMES_SHARED_MEMORY_PORT || 5190);
  if (!current.MNEMOSYNE_MCP_TOKEN || !current.HERMES_SHARED_MEMORY_PORT) {
    await writePrivateFile(HUB_ENV_FILE, `MNEMOSYNE_MCP_TOKEN=${token}\nHERMES_SHARED_MEMORY_PORT=${port}\n`);
  }
  return { token, port };
}

async function writeHubLauncher() {
  const current = await readTextIfExists(HUB_LAUNCHER_FILE);
  if (current === HUB_LAUNCHER) return false;
  await fs.writeFile(HUB_LAUNCHER_FILE, HUB_LAUNCHER);
  return true;
}

async function resolveAgentImage() {
  const override = String(process.env.HERMES_SHARED_MEMORY_IMAGE || "").trim();
  if (override) return override;
  for (const name of await discoverInstanceNames()) {
    const env = parseEnv(await readTextIfExists(path.join(ROOT, name, "instance.env")));
    if (env.HERMES_IMAGE) return env.HERMES_IMAGE;
  }
  throw Object.assign(new Error("No Hermes agent image found. Create an agent first so the shared memory hub can reuse its image."), { status: 409 });
}

type HubState = { exists: boolean; running: boolean; status: string; image: string };

async function hubState(): Promise<HubState> {
  try {
    const { stdout } = await run("docker", ["inspect", "--format", "{{.State.Status}}\t{{.Config.Image}}", HUB_CONTAINER], { timeout: 15000 });
    const [status = "unknown", image = ""] = stdout.trim().split("\t");
    return { exists: true, running: status === "running", status, image };
  } catch {
    return { exists: false, running: false, status: "not created", image: "" };
  }
}

export async function startHub() {
  const settings = await hubSettings();
  const launcherChanged = await writeHubLauncher();
  const state = await hubState();
  if (state.running && launcherChanged) {
    await run("docker", ["restart", HUB_CONTAINER], { timeout: 60000 });
    return { ...(await hubState()), port: settings.port };
  }
  if (state.running) return { ...state, port: settings.port };
  if (state.exists) {
    await run("docker", ["start", HUB_CONTAINER], { timeout: 60000 });
    return { ...(await hubState()), port: settings.port };
  }
  const image = await resolveAgentImage();
  await run("docker", [
    "run", "-d",
    "--name", HUB_CONTAINER,
    "--restart", "unless-stopped",
    "-p", `${settings.port}:${HUB_INTERNAL_PORT}`,
    "-e", `MNEMOSYNE_MCP_TOKEN=${settings.token}`,
    "-e", `MNEMOSYNE_SHARED_DB_PATH=${CONTAINER_DB_PATH}`,
    "-v", `${DB_DIR}:/data/shared`,
    "-v", `${CACHE_DIR}:/root/.cache`,
    "-v", `${HUB_LAUNCHER_FILE}:/hub-launcher.py:ro`,
    "--entrypoint", CONTAINER_PYTHON,
    image,
    "/hub-launcher.py",
  ], { timeout: 120000 });
  return { ...(await hubState()), port: settings.port };
}

export async function stopHub() {
  const state = await hubState();
  if (state.exists) await run("docker", ["stop", HUB_CONTAINER], { timeout: 60000 });
  return hubState();
}

async function runHubPython(script: string, payload: unknown, timeout = 120000) {
  await hubSettings();
  const args = JSON.stringify(payload ?? {});
  const state = await hubState();
  const result = state.running
    ? await run("docker", ["exec", "-i", HUB_CONTAINER, CONTAINER_PYTHON, "-c", script, args], { timeout })
    : await run("docker", [
      "run", "--rm",
      "-e", `MNEMOSYNE_SHARED_DB_PATH=${CONTAINER_DB_PATH}`,
      "-v", `${DB_DIR}:/data/shared`,
      "-v", `${CACHE_DIR}:/root/.cache`,
      "--entrypoint", CONTAINER_PYTHON,
      await resolveAgentImage(),
      "-c", script, args,
    ], { timeout });
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  const last = lines.at(-1) || "{}";
  try {
    return JSON.parse(last);
  } catch {
    throw new Error(`Shared memory command returned unexpected output: ${last.slice(0, 200)}`);
  }
}

export async function listSharedEntries(limit = 100) {
  return runHubPython(LIST_SCRIPT, { limit }, 60000);
}

export async function searchSharedEntries(query: string, limit = 20) {
  return runHubPython(SEARCH_SCRIPT, { query, limit }, 180000);
}

export async function addSharedEntry(content: string, kind: string, importance: number, author: string) {
  const text = String(content || "").trim();
  if (!text) throw Object.assign(new Error("Content is required"), { status: 400 });
  if (text.length > 4000) throw Object.assign(new Error("Content is limited to 4000 characters"), { status: 400 });
  const normalizedKind = ENTRY_KINDS.includes(kind) ? kind : "meta";
  const normalizedImportance = Math.min(Math.max(Number.isFinite(importance) ? importance : 0.8, 0), 1);
  const result = await runHubPython(ADD_SCRIPT, { content: text, kind: normalizedKind, importance: normalizedImportance, author: author || "console" }, 180000);
  if (result?.error) throw Object.assign(new Error(String(result.error)), { status: 400 });
  return result;
}

export async function deleteSharedEntry(id: string) {
  const trimmed = String(id || "").trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(trimmed)) throw Object.assign(new Error("Invalid entry id"), { status: 400 });
  return runHubPython(DELETE_SCRIPT, { id: trimmed }, 60000);
}

async function agentConfigPath(name: string) {
  return path.join(homeDir(name), "config.yaml");
}

function agentSkillDir(name: string) {
  return path.join(homeDir(name), "skills", SKILL_DIR_NAME);
}

async function agentLinkState(name: string) {
  const config = await readTextIfExists(await agentConfigPath(name));
  return { name, linked: isSharedMemoryConfig(config) };
}

type AgentReloadResult = {
  restarted: boolean;
  restartRequired: boolean;
  skippedReason?: "not-running" | "status-unavailable";
  error?: string;
};

async function reloadAgentIfRunning(name: string): Promise<AgentReloadResult> {
  let snapshot: Awaited<ReturnType<typeof instanceSnapshot>>;
  try {
    snapshot = await instanceSnapshot(name);
  } catch (error) {
    return {
      restarted: false,
      restartRequired: true,
      skippedReason: "status-unavailable",
      error: jobErrorText(error),
    };
  }

  if (!["running", "partial"].includes(String(snapshot.state || ""))) {
    return { restarted: false, restartRequired: false, skippedReason: "not-running" };
  }

  try {
    await runManager(["restart", name], 120000);
    return { restarted: true, restartRequired: false };
  } catch (error) {
    return {
      restarted: false,
      restartRequired: true,
      error: jobErrorText(error),
    };
  }
}

export async function linkAgent(name: string) {
  const configPath = await agentConfigPath(name);
  const config = await readTextIfExists(configPath);
  if (!config.trim()) {
    throw Object.assign(new Error("Agent config.yaml not found. Start the agent once so Hermes writes its configuration, then link again."), { status: 409 });
  }
  const settings = await hubSettings();
  const applied = upsertSharedMemoryBlock(config, sharedMemoryConfigBlock(settings.port, settings.token));
  if (applied.ok !== true) throw Object.assign(new Error(applied.reason), { status: 409 });
  await fs.writeFile(configPath, applied.config);
  const skillDir = agentSkillDir(name);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, "SKILL.md"), skillMarkdown(name));
  const reload = await reloadAgentIfRunning(name);
  return { name, linked: true, ...reload };
}

export async function unlinkAgent(name: string) {
  const configPath = await agentConfigPath(name);
  const config = await readTextIfExists(configPath);
  if (isSharedMemoryConfig(config)) {
    await fs.writeFile(configPath, removeSharedMemoryBlock(config));
  }
  await fs.rm(agentSkillDir(name), { recursive: true, force: true });
  const reload = await reloadAgentIfRunning(name);
  return { name, linked: false, ...reload };
}

export async function sharedMemoryStatus() {
  const [settings, state, names] = await Promise.all([hubSettings(), hubState(), discoverInstanceNames()]);
  const agents = await Promise.all(names.map((name) => agentLinkState(name)));
  const dbExists = await fs.access(path.join(DB_DIR, "mnemosyne.db")).then(() => true).catch(() => false);
  return {
    hub: { ...state, port: settings.port, container: HUB_CONTAINER, dbExists },
    agents,
    kinds: ENTRY_KINDS,
  };
}
