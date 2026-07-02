type HttpError = Error & { status?: number };

const SUPPORTED_PROJECT_CONTEXT_FILES = new Set(["AGENTS.md", ".hermes.md", "HERMES.md", "CLAUDE.md", ".cursorrules"]);

function badRequest(message) {
  const error = new Error(message) as HttpError;
  error.status = 400;
  return error;
}

function ensureOneOf(value, allowed, message) {
  const text = String(value || "");
  if (!allowed.includes(text)) throw badRequest(message);
  return text;
}

function validateMarkdownFileContent(value, label, maxLength) {
  const text = String(value ?? "");
  if (!text.trim()) return "";
  if (text.length > maxLength || /[\0]/.test(text)) {
    throw badRequest(`${label} must be under ${maxLength.toLocaleString()} characters`);
  }
  return text;
}

function slugifyInstanceName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
    .replace(/[-_]{2,}/g, "-")
    .slice(0, 63)
    .replace(/[^a-z0-9]+$/g, "");
}

function validateName(value) {
  const name = String(value || "").trim();
  if (/^[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?$/.test(name)) return name;
  const suggestion = slugifyInstanceName(name);
  throw badRequest(
    suggestion
      ? `Invalid instance name. Use lowercase letters, numbers, hyphens, or underscores; start and end with a letter or number. Suggested: ${suggestion}`
      : "Invalid instance name. Use lowercase letters, numbers, hyphens, or underscores; start and end with a letter or number.",
  );
}

function validateNemoClawName(value) {
  const name = validateName(value);
  if (/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name)) return name;
  throw badRequest("NemoHermes sandbox names use lowercase letters, numbers, and hyphens only.");
}

function validateId(value, pattern, message, maxLength = 120) {
  const id = String(value || "").trim();
  if (!pattern.test(id) || id.length > maxLength) throw badRequest(message);
  return id;
}

function validateProviderBaseUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const parsed = new URL(text);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("invalid");
    return parsed.toString().replace(/\/$/, "");
  } catch {
    throw badRequest("Invalid provider base URL");
  }
}

function validateBackupFilename(value) {
  const file = String(value || "").trim();
  if (!/^[A-Za-z0-9_.-]+\.tar\.gz$/.test(file) || file.includes("..")) throw badRequest("Invalid backup file");
  return file;
}

function validateBackupArchivePath(value) {
  const archivePath = String(value || "").trim();
  if (!archivePath || /[\0]/.test(archivePath) || !archivePath.endsWith(".tar.gz")) throw badRequest("Invalid backup archive path");
  return archivePath;
}

function validateFleetNodeId(value) {
  return validateId(value, /^[A-Za-z0-9_-]+$/, "Invalid Fleet node id", 80);
}

function validateNamePrefix(value) {
  const prefix = String(value || "").trim();
  if (!prefix) return "";
  if (!/^[a-z0-9][a-z0-9_-]{0,30}$/.test(prefix)) throw badRequest("Invalid name prefix");
  return prefix.endsWith("-") || prefix.endsWith("_") ? prefix : `${prefix}-`;
}

function normalizeLocalProviderBaseUrl(baseUrl, provider, enabled) {
  if (!enabled || !baseUrl) return baseUrl;
  if (!new Set(["custom", "ollama"]).has(String(provider || "").trim().toLowerCase())) return baseUrl;
  const parsed = new URL(baseUrl);
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);
  const modelServerPorts = new Set(["11434", "1234"]);
  if (!localHosts.has(parsed.hostname) || !modelServerPorts.has(parsed.port)) return baseUrl;
  parsed.hostname = "host.docker.internal";
  return parsed.toString().replace(/\/$/, "");
}

function validateCredentialKey(value, denylist) {
  const key = String(value || "").trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || key.length > 120) throw badRequest("Invalid credential key");
  if (denylist.has(key)) throw badRequest(`${key} cannot be managed as a credential`);
  return key;
}

function validateCredentialValue(value, key, suffixes) {
  const text = String(value ?? "");
  if (/[\n\r\0]/.test(text)) throw badRequest("Credential values must be single-line");
  if (key && suffixes.some((suffix) => key.endsWith(suffix)) && /[^\x00-\x7F]/.test(text)) {
    throw badRequest(`${key} must contain only ASCII characters`);
  }
  if (text.length > 16000) throw badRequest("Credential value is too long");
  return text;
}

function normalizeTelegramUserIds(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(",");
  const seen = new Set();
  const ids = [];
  for (const item of raw) {
    const id = String(item || "").trim();
    if (!id) continue;
    if (!/^[1-9]\d{4,19}$/.test(id)) throw badRequest("Trusted Telegram account IDs must be numeric");
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function normalizeCreateTelegramSetup(value = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
  if (!input.enabled) return { enabled: false };
  const botToken = String(input.botToken || "").trim();
  if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(botToken)) throw badRequest("Telegram bot setup is not complete");
  const allowedUserIds = normalizeTelegramUserIds(input.allowedUserIds || input.trustedUserId || "");
  if (!allowedUserIds.length) throw badRequest("Trusted Telegram account ID is required");
  const homeChannel = String(input.homeChannel || allowedUserIds[0]).trim();
  if (!/^-?[1-9]\d{4,19}$/.test(homeChannel)) throw badRequest("Telegram home channel must be numeric");
  const botUsername = String(input.botUsername || "").trim().replace(/^@/, "");
  if (botUsername && !/^[A-Za-z0-9_]{5,32}$/.test(botUsername)) throw badRequest("Invalid Telegram bot username");
  return {
    enabled: true,
    botToken,
    allowedUserIds,
    trustedUserId: allowedUserIds[0],
    homeChannel,
    botUsername,
  };
}

export function createValidators(options) {
  const credentialKeyDenylist = options.credentialKeyDenylist || new Set();
  const credentialSuffixes = options.credentialSuffixes || [];
  const normalizeLocalModelHosts = Boolean(options.normalizeLocalModelHosts);
  const providerIds = options.providerIds || [];
  return {
    normalizeCreateDependencies(value = {}) {
      const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
      for (const key of Object.keys(input)) {
        if (key !== "camofox") throw badRequest(`Unsupported dependency: ${key}`);
      }
      return { camofox: (input as Record<string, unknown>).camofox !== false };
    },
    normalizeCreateCapabilities(value = {}) {
      const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
      for (const key of Object.keys(input)) {
        if (!["codexCli", "payments", "sharedMemory"].includes(key)) throw badRequest(`Unsupported capability: ${key}`);
      }
      return {
        codexCli: (input as Record<string, unknown>).codexCli === true,
        payments: (input as Record<string, unknown>).payments === true,
        sharedMemory: (input as Record<string, unknown>).sharedMemory === true,
      };
    },
    normalizeCreateRuntime(value = "docker") {
      return ensureOneOf(value || "docker", ["docker", "nemoclaw"], "Invalid runtime");
    },
    normalizeBackupExport(value = {}) {
      const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
      const scope = ensureOneOf(input.scope || "fleet", ["fleet", "agent"], "Invalid backup scope");
      const names = Array.isArray(input.names) ? input.names.map(validateName) : [];
      if (scope === "agent" && !names.length) throw badRequest("Select at least one agent to export");
      return { scope, names, includeSecrets: input.includeSecrets === true, includeWorkspace: input.includeWorkspace !== false };
    },
    normalizeBackupRestore(value = {}) {
      const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
      return {
        archivePath: validateBackupArchivePath(input.archivePath),
        namePrefix: validateNamePrefix(input.namePrefix),
        restoreGlobalConfig: input.restoreGlobalConfig !== false,
        restoreSecrets: input.restoreSecrets === true,
        startRestored: input.startRestored !== false,
      };
    },
    normalizeMoveOptions(value = {}) {
      const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
      return {
        targetNodeId: validateFleetNodeId(input.targetNodeId || ""),
        includeWorkspace: input.includeWorkspace !== false,
        includeSecrets: input.includeSecrets === true,
        startTarget: input.startTarget !== false,
        removeSource: input.removeSource === true,
      };
    },
    normalizeCloneOptions(value = {}) {
      const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
      return {
        newName: validateName(input.newName || ""),
        copyWorkspace: input.copyWorkspace !== false,
        copyCredentials: input.copyCredentials !== false,
        start: input.start !== false,
      };
    },
    normalizeCreateContextFiles(value = {}) {
      const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
      const maxLength = Number(options.maxContextFileChars || 20000);
      const soul = validateMarkdownFileContent(input.soul, "SOUL.md", maxLength);
      const projectInput = input.project && typeof input.project === "object" && !Array.isArray(input.project)
        ? input.project as Record<string, any>
        : {};
      const projectContent = validateMarkdownFileContent(projectInput.content, "Project context file", maxLength);
      const contextFiles: Record<string, any> = {};
      if (soul) contextFiles.soul = soul;
      if (projectContent) {
        const filename = String(projectInput.filename || "AGENTS.md").trim();
        if (!SUPPORTED_PROJECT_CONTEXT_FILES.has(filename)) throw badRequest("Unsupported project context file");
        contextFiles.project = { filename, content: projectContent };
      }
      return contextFiles;
    },
    normalizeCreateTelegramSetup,
    normalizeLocalProviderBaseUrl: (baseUrl, provider = "") => normalizeLocalProviderBaseUrl(baseUrl, provider, normalizeLocalModelHosts),
    slugifyInstanceName,
    validateAction: (value) => ensureOneOf(value, options.instanceJobActions, "Invalid action"),
    validateBackupArchivePath,
    validateBackupFilename,
    validateChatMessage(value) {
      const message = String(value || "").trim();
      if (!message) throw badRequest("Message is required");
      if (message.length > options.maxChatMessageChars) {
        throw badRequest(`Message is too long. Keep it under ${options.maxChatMessageChars.toLocaleString()} characters.`);
      }
      return message;
    },
    validateCredentialKey: (value) => validateCredentialKey(value, credentialKeyDenylist),
    validateCredentialValue: (value, key = "") => validateCredentialValue(value, key, credentialSuffixes),
    validateFleetNodeId,
    validateName,
    validateNemoClawName,
    validateProviderId: (value) => ensureOneOf(value, providerIds, "Unsupported provider"),
    validateProviderBaseUrl,
    validateSessionId: (value) => validateId(value, /^[A-Za-z0-9_.:-]+$/, "Invalid session id", 200),
    validateTemplateId: (value) => validateId(value, /^[A-Za-z0-9_.-]+$/, "Invalid template id"),
  };
}
