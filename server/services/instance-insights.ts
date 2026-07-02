import fs from "node:fs/promises";
import { HERMES_AGENT_SRC } from "../config.ts";
import { fileExists, parseEnv, readTextIfExists } from "../lib/env-file.ts";
import { run } from "../lib/process.ts";
import { homeDir, instanceDir } from "./compose.ts";
import { PAYMENTS_ACCOUNT, PAYMENTS_CLIENT, PAYMENTS_CLIENT_PATH, PAYMENTS_SKILL } from "./payment-constants.ts";
import { readPaymentPolicy } from "./payment-policy.ts";
import { isSharedMemoryConfig } from "./shared-memory-config.ts";

const CODEX_CLI_CLIENT_PATH = "/opt/data/bin/codex";

export async function readConfig(name: string) {
  const env = parseEnv(await readTextIfExists(`${homeDir(name)}/.env`));
  const config = await readTextIfExists(`${homeDir(name)}/config.yaml`);
  const yamlValue = (section: string, key: string) => {
    let active = false;
    for (const line of config.split(/\r?\n/)) {
      if (!line.trim() || line.trim() === "---") continue;
      const top = line.match(/^([A-Za-z0-9_-]+):\s*$/);
      if (top) {
        active = top[1] === section;
        continue;
      }
      if (!active) continue;
      const value = line.match(new RegExp(`^\\s+${key}:\\s*(.*?)\\s*$`))?.[1] || "";
      if (value) return value.replace(/^["']|["']$/g, "");
    }
    return "";
  };
  return {
    provider: env.HERMES_PROVIDER || yamlValue("model", "provider"),
    model: env.HERMES_MODEL || yamlValue("model", "default"),
    baseUrl: env.HERMES_BASE_URL || yamlValue("model", "base_url"),
    memoryProvider: yamlValue("memory", "provider"),
  };
}

async function memoryDirectoryStats(dir: string) {
  let fileCount = 0;
  let totalBytes = 0;
  let lastWrite = "";
  const visit = async (target: string) => {
    let entries: any[] = [];
    try {
      entries = await fs.readdir(target, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(entries.map(async (entry) => {
      const child = `${target}/${entry.name}`;
      if (entry.isDirectory()) {
        await visit(child);
        return;
      }
      if (!entry.isFile()) return;
      try {
        const stat = await fs.stat(child);
        fileCount += 1;
        totalBytes += stat.size;
        const updated = stat.mtime.toISOString();
        if (!lastWrite || updated > lastWrite) lastWrite = updated;
      } catch {
        // Files may disappear while the agent writes memory state.
      }
    }));
  };
  await visit(dir);
  return { fileCount, totalBytes, lastWrite };
}

export async function readMemoryState(name: string, config: Record<string, string>) {
  const dataDir = `${homeDir(name)}/mnemosyne/data`;
  const pluginDir = `${homeDir(name)}/plugins/mnemosyne`;
  const [dataExists, pluginExists, stats] = await Promise.all([
    fileExists(dataDir),
    fileExists(pluginDir),
    memoryDirectoryStats(dataDir),
  ]);
  const provider = String(config.memoryProvider || "").trim();
  return {
    ok: provider === "mnemosyne" && dataExists,
    provider,
    dataDir,
    pluginOk: pluginExists,
    ...stats,
    checkedAt: new Date().toISOString(),
  };
}

function hasAnyEnv(env: Record<string, string>, keys: string[]) {
  return keys.some((key) => Boolean(String(env[key] || "").trim()));
}

export async function readCapabilities(name: string, env: Record<string, string>, config: Record<string, string>, memory: any, dependencies: Record<string, boolean>) {
  const workspacePath = `${instanceDir(name)}/workspace`;
  const [workspace, git, soul, projectContext, webInstructions, webRoot, paymentsInstructions, codexCliInstructions, codexCliAuth, agentConfig] = await Promise.all([
    fileExists(workspacePath),
    fileExists(`${workspacePath}/.git`),
    fileExists(`${homeDir(name)}/SOUL.md`),
    Promise.all(["AGENTS.md", ".hermes.md", "HERMES.md", "CLAUDE.md", ".cursorrules"].map((file) => fileExists(`${workspacePath}/${file}`)))
      .then((items) => items.some(Boolean)),
    fileExists(`${workspacePath}/HERMES_WEB.md`),
    fileExists(`${workspacePath}/web`),
    fileExists(`${workspacePath}/HERMES_PAYMENTS.md`),
    fileExists(`${workspacePath}/HERMES_CODEX_CLI.md`),
    fileExists(`${homeDir(name)}/.codex/auth.json`),
    readTextIfExists(`${homeDir(name)}/config.yaml`),
  ]);
  const paymentPolicy = paymentsInstructions ? await readPaymentPolicy(name) : null;
  const providerReady = Boolean(String(config.provider || "").trim() && String(config.model || "").trim());
  const sharedMemory = isSharedMemoryConfig(agentConfig);
  return {
    model: { ready: providerReady || hasAnyEnv(env, ["OPENAI_API_KEY", "OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_TOKEN", "GOOGLE_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY"]), provider: config.provider || "", model: config.model || "" },
    memory: { ready: Boolean(memory?.ok), provider: memory?.provider || "", lastWrite: memory?.lastWrite || "" },
    browser: { ready: dependencies.camofox !== false && Boolean(env.CAMOFOX_URL || dependencies.camofox), provider: dependencies.camofox !== false ? "camofox" : "" },
    code: { ready: workspace, workspace, git, projectContext },
    web: { ready: Boolean(env.HERMES_WEB_ROOT || webRoot), workspace: webRoot, projectContext: webInstructions },
    payments: {
      ready: paymentsInstructions,
      provider: paymentsInstructions ? "mpp-agent" : "",
      client: paymentsInstructions ? PAYMENTS_CLIENT : "",
      account: paymentsInstructions ? PAYMENTS_ACCOUNT : "",
      skill: paymentsInstructions ? PAYMENTS_SKILL : "",
      clientPath: paymentsInstructions ? PAYMENTS_CLIENT_PATH : "",
      policy: paymentPolicy,
    },
    codexCli: {
      ready: codexCliInstructions && codexCliAuth,
      provider: codexCliInstructions ? "openai-codex" : "",
      client: codexCliInstructions ? "codex" : "",
      clientPath: codexCliInstructions ? CODEX_CLI_CLIENT_PATH : "",
    },
    sharedMemory: { ready: sharedMemory, provider: sharedMemory ? "fleet-shared-memory" : "" },
    github: { ready: hasAnyEnv(env, ["GITHUB_TOKEN", "GH_TOKEN"]) },
    email: { ready: hasAnyEnv(env, ["GMAIL_TOKEN", "GOOGLE_OAUTH_ACCESS_TOKEN", "GOOGLE_API_KEY", "SMTP_HOST"]) },
    social: { ready: hasAnyEnv(env, ["X_API_KEY", "X_BEARER_TOKEN", "TWITTER_API_KEY", "TWITTER_BEARER_TOKEN", "LINKEDIN_ACCESS_TOKEN"]) },
    messaging: { ready: hasAnyEnv(env, ["SLACK_BOT_TOKEN", "SLACK_USER_TOKEN", "TELEGRAM_BOT_TOKEN", "DISCORD_BOT_TOKEN"]) },
    research: { ready: Boolean(dependencies.camofox !== false && (env.CAMOFOX_URL || dependencies.camofox)) },
    identity: { ready: soul || projectContext, soul, projectContext },
  };
}

function imageRevision(image = "") {
  const match = String(image).match(/^local\/hermes-agent:([0-9a-f]{7,40})(?:-[a-z0-9_-]+)?$/i);
  return match?.[1] || "";
}

const SOURCE_REVISION_CACHE_TTL_MS = 5 * 60 * 1000;
let sourceRevisionCache: { expiresAt: number; value: Awaited<ReturnType<typeof resolveLatestSourceRevision>> } | null = null;
let sourceRevisionRefresh: Promise<Awaited<ReturnType<typeof resolveLatestSourceRevision>>> | null = null;

function splitUpstream(upstream: string) {
  const index = upstream.indexOf("/");
  if (index <= 0 || index >= upstream.length - 1) return null;
  return { remote: upstream.slice(0, index), branch: upstream.slice(index + 1) };
}

async function remoteBranchRevision(remote: string, branch: string) {
  const remoteUrl = (await run("git", ["-C", HERMES_AGENT_SRC, "remote", "get-url", remote], { timeout: 5000 })).stdout.trim();
  const result = await run("git", ["ls-remote", remoteUrl, `refs/heads/${branch}`], { timeout: 30000 });
  const revision = result.stdout.trim().split(/\s+/)[0] || "";
  if (!/^[0-9a-f]{40}$/i.test(revision)) throw new Error(`Unable to resolve ${remote}/${branch}`);
  return revision;
}

async function resolveLatestSourceRevision() {
  const head = (await run("git", ["-C", HERMES_AGENT_SRC, "rev-parse", "--short=12", "HEAD"], { timeout: 5000 })).stdout.trim();
  const upstream = (await run("git", ["-C", HERMES_AGENT_SRC, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], { timeout: 5000 })).stdout.trim();
  const tracked = splitUpstream(upstream);
  if (tracked) {
    const remoteRevision = await remoteBranchRevision(tracked.remote, tracked.branch);
    await run("git", ["-C", HERMES_AGENT_SRC, "fetch", "--quiet", tracked.remote, `refs/heads/${tracked.branch}:refs/remotes/${tracked.remote}/${tracked.branch}`], { timeout: 30000 });
    return { revision: remoteRevision.slice(0, 12), ref: upstream, localRevision: head };
  }
  const upstreamRevision = (await run("git", ["-C", HERMES_AGENT_SRC, "rev-parse", "--short=12", upstream], { timeout: 5000 })).stdout.trim();
  return { revision: upstreamRevision, ref: upstream, localRevision: head };
}

async function latestSourceRevision(options: { refresh?: boolean } = {}) {
  const now = Date.now();
  if (!options.refresh && sourceRevisionCache && sourceRevisionCache.expiresAt > now) return sourceRevisionCache.value;
  if (sourceRevisionRefresh) return sourceRevisionRefresh;
  sourceRevisionRefresh = resolveLatestSourceRevision()
    .then((value) => {
      sourceRevisionCache = { expiresAt: Date.now() + SOURCE_REVISION_CACHE_TTL_MS, value };
      return value;
    })
    .finally(() => {
      sourceRevisionRefresh = null;
    });
  try {
    return await sourceRevisionRefresh;
  } catch {
    const head = (await run("git", ["-C", HERMES_AGENT_SRC, "rev-parse", "--short=12", "HEAD"], { timeout: 5000 })).stdout.trim();
    return { revision: head, ref: "HEAD", localRevision: head };
  }
}

export async function updateInfo(env: Record<string, string>, options: { refresh?: boolean } = {}) {
  const currentRevision = imageRevision(env.HERMES_IMAGE);
  if (!currentRevision) return { required: false, status: "unknown", versionsBehind: null, currentRevision: "", latestRevision: "", reason: "Installed revision is unavailable" };
  return updateInfoForRevision(currentRevision, options);
}

export async function updateInfoForRevision(currentRevision: string, options: { refresh?: boolean } = {}) {
  if (!/^[0-9a-f]{7,40}$/i.test(currentRevision)) return { required: false, status: "unknown", versionsBehind: null, currentRevision: "", latestRevision: "", reason: "Installed revision is unavailable" };
  try {
    const latest = await latestSourceRevision(options);
    const latestRevision = latest.revision;
    const distance = await run("git", ["-C", HERMES_AGENT_SRC, "rev-list", "--count", `${currentRevision}..${latest.ref}`], { timeout: 5000 });
    const versionsBehind = Math.max(0, Number.parseInt(distance.stdout.trim(), 10) || 0);
    if (versionsBehind === 0 && currentRevision !== latestRevision) {
      try {
        await run("git", ["-C", HERMES_AGENT_SRC, "merge-base", "--is-ancestor", currentRevision, latest.ref], { timeout: 5000 });
      } catch {
        return { required: true, status: "reversion", versionsBehind, currentRevision, latestRevision, reason: "Installed revision is ahead of the current source revision" };
      }
    }
    return { required: versionsBehind > 0, status: versionsBehind > 0 ? "behind" : "current", versionsBehind, currentRevision, latestRevision, reason: versionsBehind > 0 ? `${versionsBehind} revisions behind ${latest.ref}` : "Agent is current" };
  } catch {
    return { required: false, status: "unknown", versionsBehind: null, currentRevision, latestRevision: "", reason: "Unable to compare source revisions" };
  }
}
