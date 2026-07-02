import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import {
  GLOBAL_CREDENTIALS_FILE,
  GLOBAL_PROVIDER_FILE,
  NEMOHERMES_AUTO_INSTALL,
  NEMOHERMES_BIN,
  NEMOHERMES_INSTALL_COMMAND,
  NEMOHERMES_INSTALL_TIMEOUT_MS,
} from "../config.ts";
import { parseEnv, readTextIfExists, writePrivateFile } from "../lib/env-file.ts";
import { run } from "../lib/process.ts";
import { instanceDir } from "./compose.ts";
import { instanceDisplayName } from "./instance-meta.ts";
import { PAYMENTS_ACCOUNT, PAYMENTS_CLIENT, PAYMENTS_CLIENT_PATH, PAYMENTS_SKILL } from "./payment-constants.ts";
import { readPaymentPolicy } from "./payment-policy.ts";

const MARKER_FILE = "nemoclaw.json";
let resolvedNemoHermesBin = "";

type NemoClawMarker = {
  runtime: "nemoclaw";
  agent: "hermes";
  name: string;
  dashboardPort?: number | null;
  apiPort?: number | null;
  createdAt: string;
};

function markerPath(name: string) {
  return path.join(instanceDir(name), MARKER_FILE);
}

export async function isNemoClawInstance(name: string) {
  try {
    const marker = JSON.parse(await fs.readFile(markerPath(name), "utf8"));
    return marker?.runtime === "nemoclaw";
  } catch {
    return false;
  }
}

async function writeMarker(name: string, marker: Partial<NemoClawMarker> = {}) {
  await writePrivateFile(markerPath(name), JSON.stringify({
    runtime: "nemoclaw",
    agent: "hermes",
    name,
    apiPort: 8642,
    createdAt: new Date().toISOString(),
    ...marker,
  }, null, 2));
}

async function readMarker(name: string): Promise<NemoClawMarker> {
  return JSON.parse(await fs.readFile(markerPath(name), "utf8"));
}

function shellQuote(value: string) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function resolveCommandFromLoginShell(command: string) {
  return new Promise<string>((resolve, reject) => {
    execFile("/bin/zsh", ["-lc", `command -v ${shellQuote(command)}`], { encoding: "utf8" }, (error, stdout) => {
      const resolved = String(stdout || "").trim().split(/\r?\n/)[0] || "";
      if (error || !resolved) {
        reject(new Error(`NemoHermes runner not found: ${command}. Install NemoHermes or set NEMOHERMES_BIN to its absolute path.`));
        return;
      }
      resolve(resolved);
    });
  });
}

async function resolveCommand(command: string) {
  try {
    return await resolveCommandFromLoginShell(command);
  } catch (error) {
    const home = process.env.HOME || "";
    const localBin = home ? path.join(home, ".local", "bin", command) : "";
    if (localBin) {
      try {
        await fs.access(localBin);
        return localBin;
      } catch {
        // Fall through to the original command-not-found error.
      }
    }
    throw error;
  }
}

async function nemoHermesBin() {
  if (resolvedNemoHermesBin) return resolvedNemoHermesBin;
  if (NEMOHERMES_BIN.includes("/")) {
    resolvedNemoHermesBin = NEMOHERMES_BIN;
    return resolvedNemoHermesBin;
  }
  resolvedNemoHermesBin = await resolveCommand(NEMOHERMES_BIN);
  return resolvedNemoHermesBin;
}

async function installNemoHermes(jobId?: number, env: Record<string, string> = {}) {
  if (!NEMOHERMES_AUTO_INSTALL) {
    throw new Error(`NemoHermes runner not found: ${NEMOHERMES_BIN}. Install NemoHermes or set NEMOHERMES_AUTO_INSTALL=1.`);
  }
  if (!NEMOHERMES_INSTALL_COMMAND.trim()) {
    throw new Error("NEMOHERMES_INSTALL_COMMAND is empty; install NemoHermes manually or configure an install command.");
  }
  return run("/bin/zsh", ["-lc", NEMOHERMES_INSTALL_COMMAND], {
    jobId,
    timeout: NEMOHERMES_INSTALL_TIMEOUT_MS,
    maxBuffer: 1024 * 1024 * 8,
    env: {
      NPM_CONFIG_PREFIX: path.join(process.env.HOME || "", ".local"),
      PATH: `${path.join(process.env.HOME || "", ".local", "bin")}:${process.env.PATH || ""}`,
      NEMOCLAW_AGENT: "hermes",
      NEMOCLAW_NO_EXPRESS: "1",
      ...env,
    },
  });
}

async function ensureNemoHermesBin(jobId?: number, installEnv: Record<string, string> = {}) {
  try {
    return { bin: await nemoHermesBin(), installOutput: "" };
  } catch (firstError: any) {
    const install = await installNemoHermes(jobId, installEnv);
    resolvedNemoHermesBin = "";
    try {
      return {
        bin: await nemoHermesBin(),
        installOutput: [install.stdout, install.stderr].filter(Boolean).join("\n"),
      };
    } catch (secondError: any) {
      throw new Error(`NemoHermes install completed but ${NEMOHERMES_BIN} is still not available. ${secondError.message || firstError.message || ""}`.trim());
    }
  }
}

async function globalProvider() {
  try {
    return JSON.parse(await fs.readFile(GLOBAL_PROVIDER_FILE, "utf8"));
  } catch {
    return null;
  }
}

function nonInteractiveProviderEnv(provider: any, credentials: Record<string, string>) {
  if (!provider) {
    throw new Error("Set the Fleet provider to Ollama, OpenRouter, or a custom OpenAI-compatible endpoint before creating a NemoHermes agent.");
  }
  const model = String(provider.model || "").trim();
  const baseUrl = String(provider.baseUrl || "").trim();
  if (provider.provider === "ollama") {
    return {
      NEMOCLAW_PROVIDER: "ollama",
      ...(model ? { NEMOCLAW_MODEL: model } : {}),
    };
  }
  if (provider.provider === "openrouter") {
    const apiKey = credentials.OPENROUTER_API_KEY || "";
    if (!apiKey) {
      throw new Error("NemoHermes OpenRouter setup requires OPENROUTER_API_KEY in Fleet Settings, or switch the Fleet provider to Ollama.");
    }
    return {
      NEMOCLAW_PROVIDER: "custom",
      NEMOCLAW_ENDPOINT_URL: baseUrl || "https://openrouter.ai/api/v1",
      ...(model ? { NEMOCLAW_MODEL: model } : {}),
      COMPATIBLE_API_KEY: apiKey,
    };
  }
  if (provider.provider === "custom") {
    const apiKey = credentials.COMPATIBLE_API_KEY || credentials.OPENAI_API_KEY || "";
    if (!apiKey) {
      throw new Error("NemoHermes custom endpoint setup requires COMPATIBLE_API_KEY or OPENAI_API_KEY in Fleet Settings, or switch the Fleet provider to Ollama.");
    }
    if (!baseUrl) {
      throw new Error("NemoHermes custom endpoint setup requires a provider base URL, or switch the Fleet provider to Ollama.");
    }
    return {
      NEMOCLAW_PROVIDER: "custom",
      NEMOCLAW_ENDPOINT_URL: baseUrl,
      ...(model ? { NEMOCLAW_MODEL: model } : {}),
      COMPATIBLE_API_KEY: apiKey,
    };
  }
  if (provider.provider === "openai-codex") {
    throw new Error("NemoHermes agents cannot use the fleet OpenAI Codex device-login provider. Switch Fleet Settings to Ollama, OpenRouter, or a custom OpenAI-compatible endpoint with an API key before creating a NemoHermes agent.");
  }
  return model ? { NEMOCLAW_MODEL: model } : {};
}

export async function createNemoHermesSandbox(name: string, _dashboardPort: number | null, jobId: number, timeout: number) {
  await fs.mkdir(instanceDir(name), { recursive: true, mode: 0o700 });
  await writeMarker(name, { dashboardPort: null });
  try {
    const credentials = parseEnv(await readTextIfExists(GLOBAL_CREDENTIALS_FILE));
    const provider = await globalProvider();
    const onboardingEnv = {
      ...credentials,
      ...nonInteractiveProviderEnv(provider, credentials),
      NEMOCLAW_AGENT: "hermes",
      NEMOCLAW_SANDBOX_NAME: name,
      NEMOCLAW_NON_INTERACTIVE: "1",
      NEMOCLAW_ACCEPT_THIRD_PARTY_SOFTWARE: "1",
      NEMOCLAW_YES: "1",
    };
    const ready = await ensureNemoHermesBin(jobId, onboardingEnv);
    const args = [
      "onboard",
      "--non-interactive",
      "--yes-i-accept-third-party-software",
      "--name",
      name,
      "--agent",
      "hermes",
      "--fresh",
    ];
    const result = await run(ready.bin, args, {
      jobId,
      timeout,
      maxBuffer: 1024 * 1024 * 8,
      env: onboardingEnv,
    });
    await writeMarker(name, { dashboardPort: null });
    return {
      stdout: [ready.installOutput, result.stdout].filter(Boolean).join("\n"),
      stderr: result.stderr,
    };
  } catch (error) {
    await fs.rm(instanceDir(name), { recursive: true, force: true });
    throw error;
  }
}

async function tryRun(args: string[], timeout = 15000, env: Record<string, string> = {}) {
  try {
    return await run(await nemoHermesBin(), args, { timeout, maxBuffer: 1024 * 1024 * 2, env });
  } catch {
    return null;
  }
}

function findSandboxFromList(payload: any, name: string) {
  const candidates = [
    payload?.sandboxes,
    payload?.sandboxInventory,
    payload?.items,
    payload?.sessions,
  ].find(Array.isArray) || [];
  return candidates.find((item: any) => item?.name === name || item?.sandbox === name || item?.id === name) || null;
}

function stateFromText(text = "") {
  const lower = text.toLowerCase();
  if (/running|ready|healthy|active/.test(lower)) return "running";
  if (/stopped|offline/.test(lower)) return "stopped";
  return "unknown";
}

export async function nemoHermesSnapshot(name: string) {
  const marker = await readMarker(name);
  const displayName = instanceDisplayName(name);
  const paymentsReady = await fs.access(path.join(instanceDir(name), "workspace", "HERMES_PAYMENTS.md")).then(() => true, () => false);
  const paymentPolicy = paymentsReady ? await readPaymentPolicy(name) : null;
  const list = await tryRun(["list", "--json"]);
  let listed: any = null;
  if (list?.stdout) {
    try {
      listed = findSandboxFromList(JSON.parse(list.stdout), name);
    } catch {
      listed = null;
    }
  }
  const status = await tryRun([name, "status"]);
  const dashboardUrl = (await tryRun([name, "dashboard-url", "--quiet"]))?.stdout.trim()
    || listed?.dashboardUrl
    || listed?.dashboardURL
    || "";
  const state = String(listed?.state || listed?.status || stateFromText(status?.stdout || ""));
  const running = state === "running" ? 1 : 0;
  return {
    name,
    displayName,
    state,
    runtime: "nemoclaw",
    composeAvailable: false,
    services: listed ? [listed] : [],
    serviceCount: 1,
    runningServices: running,
    health: { dashboard: Boolean(dashboardUrl), web: false, camofox: false, activeTabs: null, activeSessions: null },
    endpoints: { dashboard: dashboardUrl, lanDashboard: dashboardUrl, vnc: "", lanVnc: "", web: "", lanWeb: "" },
    ports: { dashboard: dashboardUrl ? marker.dashboardPort || null : null, vnc: null, health: marker.apiPort || 8642, web: null },
    paths: { root: instanceDir(name), home: "", compose: "" },
    dependencies: { camofox: false },
    network: { lanAddress: "127.0.0.1", healthPort: marker.apiPort || 8642 },
    config: { provider: listed?.provider || "", model: listed?.model || "", agent: "hermes" },
    memory: { ok: false, provider: "", pluginOk: false, fileCount: 0, totalBytes: 0 },
    capabilities: {
      payments: {
        ready: paymentsReady,
        provider: paymentsReady ? "mpp-agent" : "",
        client: paymentsReady ? PAYMENTS_CLIENT : "",
        account: paymentsReady ? PAYMENTS_ACCOUNT : "",
        skill: paymentsReady ? PAYMENTS_SKILL : "",
        clientPath: paymentsReady ? PAYMENTS_CLIENT_PATH : "",
        policy: paymentPolicy,
      },
      codexCli: { ready: false, provider: "", client: "", clientPath: "" },
      sharedMemory: { ready: false, provider: "" },
    },
    update: { status: "unknown", versionsBehind: null },
    drift: { status: "unknown", summary: "NemoHermes drift checks are not running" },
    timeline: [],
  };
}

export async function runNemoHermesAction(name: string, action: string, timeout: number) {
  if (action === "delete") {
    const result = await run(await nemoHermesBin(), [name, "destroy", "--yes"], { timeout, maxBuffer: 1024 * 1024 * 8 });
    await fs.rm(instanceDir(name), { recursive: true, force: true });
    return result;
  }
  if (action === "restart") {
    const env = { NEMOCLAW_SANDBOX_NAME: name };
    const bin = await nemoHermesBin();
    const stop = await run(bin, ["stop"], { timeout, maxBuffer: 1024 * 1024 * 8, env });
    const start = await run(bin, ["start"], { timeout, maxBuffer: 1024 * 1024 * 8, env });
    return { stdout: [stop.stdout, start.stdout].filter(Boolean).join("\n"), stderr: [stop.stderr, start.stderr].filter(Boolean).join("\n") };
  }
  if (action === "start" || action === "stop") {
    return run(await nemoHermesBin(), [action], { timeout, maxBuffer: 1024 * 1024 * 8, env: { NEMOCLAW_SANDBOX_NAME: name } });
  }
  if (action === "update") {
    return run(await nemoHermesBin(), [name, "rebuild"], { timeout, maxBuffer: 1024 * 1024 * 8 });
  }
  throw new Error(`Unsupported NemoHermes action: ${action}`);
}

export async function runNemoHermesSkillInstall(name: string, skill: string, timeout: number) {
  return run(await nemoHermesBin(), [name, "skill", "install", skill], {
    timeout,
    maxBuffer: 1024 * 1024 * 4,
  });
}

export async function runNemoHermesExec(name: string, command: string, timeout: number) {
  return run(await nemoHermesBin(), [name, "exec", "bash", "-lc", command], {
    timeout,
    maxBuffer: 1024 * 1024 * 4,
  });
}
