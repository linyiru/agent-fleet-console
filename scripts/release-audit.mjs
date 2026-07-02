#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";

const MAX_SOURCE_LINES = 400;
const GENERATED = new Set([".gitignore", "package-lock.json"]);
const REQUIRED_FILES = [
  "README.md",
  "LICENSE",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SUPPORT.md",
  "knip.json",
  ".github/workflows/release.yml",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
];
const REQUIRED_PACKAGE_SCRIPTS = ["check", "test", "build", "audit:release", "knip", "release:check"];
const SENSITIVE_TEXT_WARNING_ALLOWLIST = new Set([
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
]);
const SOURCE_LINE_LIMITS = new Map([
  ["bin/hermes-docker.d/00-commands.bash", 500],
  ["server/services/fleet-nodes.ts", 700],
  ["src/controllers/useFleetConsole.ts", 500],
  ["src/models/fleet.ts", 500],
  ["src/styles/layout.css", 500],
  ["src/views/CreateAgentModal.tsx", 500],
  ["src/views/FleetDashboard.tsx", 1100],
  ["src/views/SettingsProvidersTab.tsx", 500],
  ["src/views/useChatPanel.ts", 500],
]);
const RUNTIME_PREFIXES = ["data/", "logs/", "runtime/", "secrets/", "vendor/hermes-agent/"];
const RUNTIME_FILES = new Set([".env", ".DS_Store", "console.log"]);
const SOURCE_EXTENSIONS = new Set([".bash", ".css", ".js", ".jsx", ".mjs", ".sh", ".ts", ".tsx", ".py"]);
const SECRET_PATTERNS = [
  { label: "private key", re: /BEGIN [A-Z ]*PRIVATE KEY/ },
  { label: "OpenAI-style key", re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { label: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/ },
  { label: "Telegram token", re: /\b\d{7,12}:[A-Za-z0-9_-]{24,}\b/ },
  { label: "long bearer token", re: /Bearer\s+[A-Za-z0-9._~+/=-]{40,}/i },
];

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `${command} failed`);
  return result.stdout;
}

function extension(file) {
  const match = file.match(/(\.[^.]+)$/);
  return match ? match[1] : "";
}

function isSourceFile(file) {
  return SOURCE_EXTENSIONS.has(extension(file)) || file.startsWith("bin/");
}

async function textFile(file) {
  try {
    const buffer = await readFile(file);
    if (buffer.includes(0)) return "";
    return buffer.toString("utf8");
  } catch {
    return "";
  }
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

const tracked = run("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
const failures = [];
const warnings = [];

for (const file of REQUIRED_FILES) {
  if (!await exists(file)) failures.push(`missing public release file: ${file}`);
}

try {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  for (const script of REQUIRED_PACKAGE_SCRIPTS) {
    if (!packageJson.scripts?.[script]) failures.push(`missing package script: ${script}`);
  }
} catch (error) {
  failures.push(`package.json could not be parsed: ${error.message}`);
}

const releaseWorkflow = await textFile(".github/workflows/release.yml");
if (releaseWorkflow && !releaseWorkflow.includes("npm run release:check")) {
  failures.push("release workflow does not run npm run release:check");
}

for (const file of tracked) {
  if (!await exists(file)) continue;
  if (RUNTIME_FILES.has(file) || RUNTIME_PREFIXES.some((prefix) => file.startsWith(prefix))) {
    failures.push(`tracked runtime artifact: ${file}`);
  }
  const text = await textFile(file);
  if (!text) continue;
  if (isSourceFile(file) && !GENERATED.has(file)) {
    const lines = text.split(/\r?\n/).length;
    const lineLimit = SOURCE_LINE_LIMITS.get(file) || MAX_SOURCE_LINES;
    if (lines > lineLimit) failures.push(`source file over ${lineLimit} lines: ${file} (${lines})`);
  }
  if (!GENERATED.has(file)) {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.re.test(text)) failures.push(`possible ${pattern.label}: ${file}`);
    }
  }
  if (!GENERATED.has(file) && !SENSITIVE_TEXT_WARNING_ALLOWLIST.has(file) && !isSourceFile(file) && /password|token|secret|credential/i.test(text) && !/\.(md|example)$/i.test(file)) {
    warnings.push(`sensitive terminology in non-source file: ${file}`);
  }
}

if (warnings.length) {
  console.log("Release audit warnings:");
  for (const item of warnings) console.log(`- ${item}`);
}

if (failures.length) {
  console.error("Release audit failed:");
  for (const item of failures) console.error(`- ${item}`);
  process.exit(1);
}

console.log(`Release audit passed for ${tracked.length} tracked files.`);
