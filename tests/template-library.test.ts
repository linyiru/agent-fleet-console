import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  copySanitizedTemplateTree,
  sanitizeTemplateConfig,
  templateRequiredEnvKeys,
} from "../server/services/template-library-sanitize.ts";
import { sharedMemoryConfigBlock } from "../server/services/shared-memory-config.ts";

test("template sanitizer removes secrets, Codex auth, and shared-memory bearer config", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fleet-template-sanitize-"));
  const source = path.join(root, "home");
  const target = path.join(root, "out");
  await fs.mkdir(path.join(source, ".codex"), { recursive: true });
  await fs.writeFile(path.join(source, ".env"), "OPENAI_API_KEY=sk-secret\n");
  await fs.writeFile(path.join(source, ".codex", "auth.json"), JSON.stringify({ refresh_token: "secret-refresh" }));
  await fs.writeFile(path.join(source, "api-token.txt"), "secret-token");
  await fs.writeFile(path.join(source, "SOUL.md"), "hello\n");
  await fs.writeFile(path.join(source, "config.yaml"), `model:\n  provider: ollama\n\n${sharedMemoryConfigBlock(5190, "bearer-secret")}\n`);

  try {
    await copySanitizedTemplateTree(source, target);
    assert.equal(await exists(path.join(target, ".env")), false);
    assert.equal(await exists(path.join(target, ".codex", "auth.json")), false);
    assert.equal(await exists(path.join(target, "api-token.txt")), false);
    assert.equal(await fs.readFile(path.join(target, "SOUL.md"), "utf8"), "hello\n");
    const config = await fs.readFile(path.join(target, "config.yaml"), "utf8");
    assert.match(config, /provider: ollama/);
    assert.equal(config.includes("bearer-secret"), false);
    assert.equal(config.includes("fleet-shared-memory"), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("template required secret metadata records names only", () => {
  const keys = templateRequiredEnvKeys([
    "OPENAI_API_KEY=sk-super-secret",
    "TELEGRAM_BOT_TOKEN=123456:telegram-secret",
    "TELEGRAM_ALLOWED_USERS=123456789",
    "TELEGRAM_HOME_CHANNEL=123456789",
    "HERMES_WEB_ROOT=/opt/data/workspace/web",
  ].join("\n"));
  assert.deepEqual(keys, ["OPENAI_API_KEY", "TELEGRAM_ALLOWED_USERS", "TELEGRAM_BOT_TOKEN", "TELEGRAM_HOME_CHANNEL"]);
  assert.equal(JSON.stringify(keys).includes("super-secret"), false);
  assert.equal(JSON.stringify(keys).includes("telegram-secret"), false);
});

test("sanitizeTemplateConfig strips only the managed shared-memory block", () => {
  const config = `model:\n  provider: ollama\n\n${sharedMemoryConfigBlock(5190, "tok")}\nmemory:\n  provider: mnemosyne\n`;
  const sanitized = sanitizeTemplateConfig(config);
  assert.match(sanitized, /provider: ollama/);
  assert.match(sanitized, /provider: mnemosyne/);
  assert.equal(sanitized.includes("tok"), false);
});

test("sanitizeTemplateConfig strips unmarked fleet shared-memory blocks", () => {
  const config = `model:\n  provider: ollama\nmcp_servers:\n  fleet-shared-memory:\n    url: http://host.docker.internal:5190/sse\n    headers:\n      Authorization: Bearer source-token\nplugins:\n  enabled: []\n`;
  const sanitized = sanitizeTemplateConfig(config);
  assert.match(sanitized, /provider: ollama/);
  assert.match(sanitized, /plugins:\n  enabled: \[\]/);
  assert.equal(sanitized.includes("source-token"), false);
  assert.equal(sanitized.includes("fleet-shared-memory"), false);
  assert.equal(/^mcp_servers\s*:/m.test(sanitized), false);
});

test("template capture stores a secret-free archive and deploys to an exact new name", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fleet-template-service-"));
  const dataDir = path.join(root, "data");
  const secretsDir = path.join(root, "secrets");
  const fakeDocker = path.join(root, "hermes-docker");
  const previous = snapshotEnv([
    "HERMES_INSTANCES_ROOT",
    "HERMES_CONSOLE_DATA_DIR",
    "HERMES_CONSOLE_DB",
    "HERMES_CONSOLE_SECRETS_DIR",
    "HERMES_DOCKER_BIN",
  ]);

  await fs.writeFile(fakeDocker, `#!/usr/bin/env sh
set -eu
if [ "$1" = "deploy" ]; then
  name="$2"
  mkdir -p "$HERMES_INSTANCES_ROOT/$name/home" "$HERMES_INSTANCES_ROOT/$name/workspace"
  printf 'services: {}\\n' > "$HERMES_INSTANCES_ROOT/$name/compose.yaml"
fi
exit 0
`);
  await fs.chmod(fakeDocker, 0o755);
  process.env.HERMES_INSTANCES_ROOT = root;
  process.env.HERMES_CONSOLE_DATA_DIR = dataDir;
  process.env.HERMES_CONSOLE_DB = path.join(dataDir, "fleet.db");
  process.env.HERMES_CONSOLE_SECRETS_DIR = secretsDir;
  process.env.HERMES_DOCKER_BIN = fakeDocker;

  try {
    const source = path.join(root, "source-agent");
    await fs.mkdir(path.join(source, "home"), { recursive: true });
    await fs.mkdir(path.join(source, "workspace"), { recursive: true });
    await fs.writeFile(path.join(source, "compose.yaml"), "services: {}\n");
    await fs.writeFile(path.join(source, "home", "SOUL.md"), "source soul\n");
    await fs.writeFile(path.join(source, "home", "config.yaml"), "model:\n  provider: ollama\n  default: qwen\n");
    await fs.writeFile(path.join(source, "home", ".env"), "OPENAI_API_KEY=sk-captured-secret\n");
    await fs.writeFile(path.join(source, "workspace", "AGENTS.md"), "project context\n");

    const service = await import(`../server/services/template-library.ts?case=${Date.now()}`);
    const captured = await service.captureTemplate({
      sourceName: "source-agent",
      name: "Reusable source",
      description: "Captured in test",
      includeWorkspace: true,
    });
    assert.equal(captured.template.name, "Reusable source");
    assert.equal(captured.manifest.requirements.envKeys.includes("OPENAI_API_KEY"), true);
    const listed = await service.listTemplateLibrary();
    assert.equal(listed.templates.length, 1);

    await service.runTemplateDeploy({
      archivePath: captured.archive.path,
      name: "deployed-agent",
      start: false,
      allowMissingRequirements: true,
    });
    assert.equal(await fs.readFile(path.join(root, "deployed-agent", "home", "SOUL.md"), "utf8"), "source soul\n");
    assert.equal(await exists(path.join(root, "deployed-agent", "home", ".env")), false);
    await assert.rejects(() => service.runTemplateDeploy({
      archivePath: captured.archive.path,
      name: "deployed-agent",
      start: false,
      allowMissingRequirements: true,
    }), /already exists/);
  } finally {
    restoreEnv(previous);
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function exists(file: string) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function snapshotEnv(names: string[]) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnv(values: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
