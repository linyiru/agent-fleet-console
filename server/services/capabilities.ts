import fs from "node:fs/promises";
import path from "node:path";
import { HERMES_DOCKER } from "../config.ts";
import { run } from "../lib/process.ts";
import { composeExecArgs, homeDir, workspaceDir } from "./compose.ts";
import { runNemoHermesExec, runNemoHermesSkillInstall } from "./nemoclaw.ts";
import { applyCodexCliAuthToInstance } from "./oauth.ts";
import { PAYMENTS_ACCOUNT, PAYMENTS_CLIENT, PAYMENTS_CLIENT_PATH, PAYMENTS_SKILL } from "./payment-constants.ts";
import { writePaymentPolicy } from "./payment-policy.ts";
import { linkAgent, startHub } from "./shared-memory.ts";

type CreateCapabilities = {
  codexCli?: boolean;
  payments?: boolean;
  sharedMemory?: boolean;
};

const CODEX_CLI_PACKAGE = "@openai/codex";
const CODEX_CLI_PATH = "/opt/data/.npm-global/bin/codex";
const CODEX_CLI_WRAPPER = "/opt/data/bin/codex";

async function writePaymentsInstructions(name: string) {
  const workspace = workspaceDir(name);
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, "HERMES_PAYMENTS.md"), `# Hermes Payments Capability

This agent was created with payments support.

- Hermes optional skill: \`${PAYMENTS_SKILL}\`
- Purpose: pay HTTP 402 APIs via Machine Payments Protocol (MPP).
- Default wallet client: \`${PAYMENTS_CLIENT}\`.
- Default account: \`${PAYMENTS_ACCOUNT}\`.
- Client install path: \`${PAYMENTS_CLIENT_PATH}\`.
- Verification: \`mppx --version && mppx account list\`.
- Wallet clients may include Tempo Wallet, Privy Agent CLI, AgentCash, mppx, or Stripe Link when the 402 challenge advertises Stripe.
- Do not paste wallet keys, account credentials, payment tokens, or private key material into chat, logs, or project files. Payment clients should keep credentials in their own config stores.
- Before paying a non-zero amount, clearly confirm the target URL, method, amount, currency, and spending source with the operator.
`);
}

function paymentsBootstrapScript() {
  return `
set -euo pipefail
export NPM_CONFIG_PREFIX="/opt/data/.npm-global"
export PATH="/opt/data/bin:$NPM_CONFIG_PREFIX/bin:$PATH"
mkdir -p "$NPM_CONFIG_PREFIX/bin"
for profile in /opt/data/.profile /opt/data/.bashrc; do
  touch "$profile"
  grep -qxF 'export PATH="/opt/data/bin:/opt/data/.npm-global/bin:$PATH"' "$profile" || echo 'export PATH="/opt/data/bin:/opt/data/.npm-global/bin:$PATH"' >> "$profile"
done
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to install mppx" >&2
  exit 1
fi
if ! command -v mppx >/dev/null 2>&1; then
  npm install -g mppx
fi
if ! mppx account list 2>/dev/null | grep -F "${PAYMENTS_ACCOUNT}" >/dev/null 2>&1; then
  mppx account create --account "${PAYMENTS_ACCOUNT}" >/dev/null
fi
mppx account default --account "${PAYMENTS_ACCOUNT}" 2>/dev/null || true
mppx --version
mppx account list
`;
}

async function bootstrapPaymentsWallet(name: string, runtime: string) {
  const script = paymentsBootstrapScript();
  if (runtime === "nemoclaw") return runNemoHermesExec(name, script, 180000);
  return run("docker", composeExecArgs(name, "hermes", ["bash", "-lc", script]), {
    timeout: 180000,
    maxBuffer: 1024 * 1024 * 4,
  });
}

async function writeCodexCliAuth(name: string) {
  await applyCodexCliAuthToInstance(name, { required: true });
}

async function writeCodexCliConfig(name: string) {
  const codexHome = path.join(homeDir(name), ".codex");
  const configFile = path.join(codexHome, "config.toml");
  await fs.mkdir(codexHome, { recursive: true });
  let config = "";
  try {
    config = await fs.readFile(configFile, "utf8");
  } catch {
    // First-time Codex CLI setup for this agent.
  }
  if (!/^\s*cli_auth_credentials_store\s*=/m.test(config)) {
    const next = `${config.trimEnd()}${config.trim() ? "\n\n" : ""}cli_auth_credentials_store = "file"\n`;
    await fs.writeFile(configFile, next, { mode: 0o600 });
  }
}

async function writeCodexCliInstructions(name: string) {
  const workspace = workspaceDir(name);
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, "HERMES_CODEX_CLI.md"), `# Codex CLI Capability

This agent was created with OpenAI Codex CLI support.

- CLI package: \`${CODEX_CLI_PACKAGE}\`
- Command: \`codex\` or \`${CODEX_CLI_WRAPPER}\`
- Installed path: \`${CODEX_CLI_PATH}\`
- Auth file: \`/opt/data/.codex/auth.json\`
- Credential store: file-backed Codex auth
- Auth source: Fleet's saved OpenAI Codex device login

Use Codex CLI for coding work inside git repositories. For one-shot tasks:

\`\`\`bash
codex exec "Implement the requested change"
\`\`\`

If \`codex\` is not on PATH in a non-interactive shell, use \`${CODEX_CLI_WRAPPER}\`.
Do not run a separate \`codex login\` unless the Fleet-managed device login has expired or been intentionally replaced.
`);
}

function codexCliBootstrapScript() {
  return `
set -euo pipefail
export HOME="/opt/data"
export NPM_CONFIG_PREFIX="/opt/data/.npm-global"
export PATH="/opt/data/bin:$NPM_CONFIG_PREFIX/bin:$PATH"
mkdir -p "$NPM_CONFIG_PREFIX/bin" /opt/data/bin /opt/data/.codex
for profile in /opt/data/.profile /opt/data/.bashrc; do
  touch "$profile"
  grep -qxF 'export PATH="/opt/data/bin:/opt/data/.npm-global/bin:$PATH"' "$profile" || echo 'export PATH="/opt/data/bin:/opt/data/.npm-global/bin:$PATH"' >> "$profile"
done
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to install ${CODEX_CLI_PACKAGE}" >&2
  exit 1
fi
if [ ! -x "${CODEX_CLI_PATH}" ]; then
  npm install -g ${CODEX_CLI_PACKAGE}
fi
cat > "${CODEX_CLI_WRAPPER}" <<'SH'
#!/usr/bin/env sh
export HOME="\${HOME:-/opt/data}"
export CODEX_HOME="\${CODEX_HOME:-/opt/data/.codex}"
export NPM_CONFIG_PREFIX="\${NPM_CONFIG_PREFIX:-/opt/data/.npm-global}"
exec "$NPM_CONFIG_PREFIX/bin/codex" "$@"
SH
chmod +x "${CODEX_CLI_WRAPPER}"
if ! [ -s /opt/data/.codex/auth.json ]; then
  echo "Codex CLI auth file is missing" >&2
  exit 1
fi
chown -R hermes:dialout /opt/data/.npm-global /opt/data/.codex /opt/data/bin /opt/data/.profile /opt/data/.bashrc 2>/dev/null || true
"${CODEX_CLI_PATH}" --version
"${CODEX_CLI_PATH}" login status
`;
}

async function bootstrapCodexCli(name: string, runtime: string) {
  if (runtime === "nemoclaw") {
    throw Object.assign(new Error("Codex CLI capability is only supported for Docker Hermes agents."), { status: 400 });
  }
  await writeCodexCliAuth(name);
  await writeCodexCliConfig(name);
  await writeCodexCliInstructions(name);
  return run("docker", composeExecArgs(name, "hermes", ["bash", "-lc", codexCliBootstrapScript()]), {
    timeout: 180000,
    maxBuffer: 1024 * 1024 * 4,
  });
}

export async function applyCreateCapabilities(name: string, capabilities: CreateCapabilities = {}, runtime = "docker") {
  const result: Record<string, unknown> = { codexCli: false, payments: false, sharedMemory: false };

  if (capabilities.sharedMemory) {
    if (runtime === "nemoclaw") throw Object.assign(new Error("Shared memory capability is only supported for Docker Hermes agents."), { status: 400 });
    await startHub();
    const link = await linkAgent(name);
    result.sharedMemory = {
      linked: link.linked,
      restarted: link.restarted,
      restartRequired: link.restartRequired,
      skippedReason: link.skippedReason || "",
    };
  }

  if (capabilities.codexCli) {
    const installed = await bootstrapCodexCli(name, runtime);
    result.codexCli = {
      ready: true,
      package: CODEX_CLI_PACKAGE,
      command: "codex",
      path: CODEX_CLI_WRAPPER,
      output: installed.stdout.trim().split(/\r?\n/).at(-1) || "",
    };
  }

  if (capabilities.payments) {
    await writePaymentsInstructions(name);
    await writePaymentPolicy(name, { defaultAccount: PAYMENTS_ACCOUNT });
    if (runtime === "nemoclaw") {
      await runNemoHermesSkillInstall(name, PAYMENTS_SKILL, 120000);
    } else {
      await run(HERMES_DOCKER, ["hermes", name, "skills", "install", PAYMENTS_SKILL], {
        timeout: 120000,
        maxBuffer: 1024 * 1024 * 4,
      });
    }
    await bootstrapPaymentsWallet(name, runtime);
    result.payments = true;
    result.skill = PAYMENTS_SKILL;
    result.wallet = PAYMENTS_CLIENT;
    result.account = PAYMENTS_ACCOUNT;
  }

  return result;
}
