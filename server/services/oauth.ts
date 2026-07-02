import path from "node:path";
import {
  CODEX_BASE_URL,
  CODEX_AUTH_ISSUER,
  CODEX_DEVICE_TOKEN_URL,
  CODEX_DEVICE_USER_CODE_URL,
  CODEX_DEVICE_VERIFICATION_URL,
  CODEX_OAUTH_CLIENT_ID,
  CODEX_OAUTH_TOKEN_URL,
} from "../catalog.ts";
import { GLOBAL_OAUTH_DIR, HERMES_AGENT_SRC } from "../config.ts";
import { fileExists, readTextIfExists, writePrivateFile } from "../lib/env-file.ts";
import { run } from "../lib/process.ts";
import { homeDir } from "./compose.ts";

type OAuthSession = {
  id: string;
  provider: string;
  status: "pending" | "complete" | "failed";
  deviceAuthId: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  interval: number;
  error?: string;
};

const sessions = new Map<string, OAuthSession>();

class OAuthHttpError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code = "") {
    super(message);
    this.name = "OAuthHttpError";
    this.status = status;
    this.code = code;
  }
}

function oauthFile(provider: string) {
  return path.join(GLOBAL_OAUTH_DIR, `${provider}.json`);
}

function decodeJwtClaims(token = "") {
  const payload = String(token || "").split(".")[1] || "";
  if (!payload) return {};
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
  } catch {
    return {};
  }
}

function codexAccountId(tokens: any) {
  const idClaims: any = decodeJwtClaims(tokens.id_token);
  const accessClaims: any = decodeJwtClaims(tokens.access_token);
  const idAuth = idClaims?.["https://api.openai.com/auth"] || {};
  const accessAuth = accessClaims?.["https://api.openai.com/auth"] || {};
  return String(
    tokens.account_id
    || idAuth.chatgpt_account_id
    || accessAuth.chatgpt_account_id
    || accessAuth.poid
    || "",
  ).trim();
}

async function readCodexOAuthPayload() {
  return JSON.parse(await readTextIfExists(oauthFile("openai-codex")) || "null");
}

async function hermesPython() {
  const candidates = [
    path.join(HERMES_AGENT_SRC, "venv", "bin", "python"),
    path.join(HERMES_AGENT_SRC, ".venv", "bin", "python"),
  ];
  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }
  return "python3";
}

function publicSession(session: OAuthSession) {
  const { deviceAuthId, ...safe } = session;
  return safe;
}

function oauthErrorDetail(data: any, status: number) {
  const error = data?.error;
  const code = typeof error === "string" ? error : String(error?.code || "");
  const message = String(
    data?.error_description
    || data?.message
    || (typeof error === "string" ? error : error?.message)
    || `OAuth HTTP ${status}`,
  );
  return { code, message };
}

async function codexFetchJson(url: string, body: Record<string, unknown>, contentType: "json" | "form" = "json") {
  const requestBody = contentType === "form"
    ? new URLSearchParams(Object.fromEntries(Object.entries(body).map(([key, value]) => [key, String(value)]))).toString()
    : JSON.stringify(body);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": contentType === "form" ? "application/x-www-form-urlencoded" : "application/json" },
    body: requestBody,
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = oauthErrorDetail(data, response.status);
    throw new OAuthHttpError(detail.message, response.status, detail.code);
  }
  return data;
}

async function exchangeAuthorizationCode(code: string, codeVerifier: string) {
  return codexFetchJson(CODEX_OAUTH_TOKEN_URL, {
    grant_type: "authorization_code",
    code,
    redirect_uri: `${CODEX_AUTH_ISSUER}/deviceauth/callback`,
    client_id: CODEX_OAUTH_CLIENT_ID,
    code_verifier: codeVerifier,
  }, "form");
}

async function saveCodexCredential(tokens: any) {
  const payload = {
    provider: "openai-codex",
    label: "Fleet Codex device login",
    base_url: CODEX_BASE_URL,
    tokens,
    saved_at: new Date().toISOString(),
  };
  await writePrivateFile(oauthFile("openai-codex"), JSON.stringify(payload, null, 2));
}

async function pollCodex(session: OAuthSession) {
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline && session.status === "pending") {
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, session.interval) * 1000));
    try {
      const tokens = await codexFetchJson(CODEX_DEVICE_TOKEN_URL, {
        device_auth_id: session.deviceAuthId,
        user_code: session.userCode,
      });
      const exchangedTokens = await exchangeAuthorizationCode(tokens.authorization_code, tokens.code_verifier);
      await saveCodexCredential(exchangedTokens);
      session.status = "complete";
      return;
    } catch (error: any) {
      if (
        error?.code === "authorization_pending"
        || error?.status === 403
        || error?.status === 404
      ) continue;
      session.status = "failed";
      session.error = String(error?.message || "Codex device login failed.");
      return;
    }
  }
  if (session.status === "pending") {
    session.status = "failed";
    session.error = "Device login expired.";
  }
}

export async function startOauth(provider: string) {
  if (provider !== "openai-codex") throw new Error("Only OpenAI Codex device login is supported.");
  const data = await codexFetchJson(CODEX_DEVICE_USER_CODE_URL, {
    client_id: CODEX_OAUTH_CLIENT_ID,
    scope: "openid profile email offline_access",
  });
  const session: OAuthSession = {
    id: crypto.randomUUID(),
    provider,
    status: "pending",
    deviceAuthId: data.device_auth_id || data.device_code,
    userCode: data.user_code || data.usercode,
    verificationUri: data.verification_uri || data.verification_url || CODEX_DEVICE_VERIFICATION_URL,
    verificationUriComplete: data.verification_uri_complete || data.verification_uri || data.verification_url || CODEX_DEVICE_VERIFICATION_URL,
    interval: Number(data.interval || 5),
  };
  if (!session.deviceAuthId || !session.userCode) throw new Error("Codex device login response was missing a device auth id or user code.");
  sessions.set(session.id, session);
  pollCodex(session);
  return publicSession(session);
}

export function getOauthSession(provider: string, id: string) {
  const session = sessions.get(id);
  if (!session || session.provider !== provider) return null;
  return publicSession(session);
}

export async function oauthSummaries() {
  const payload = await readCodexOAuthPayload();
  return payload ? [{ provider: "openai-codex", label: payload.label, savedAt: payload.saved_at }] : [];
}

export async function codexCliAuthPayload() {
  const payload = await readCodexOAuthPayload();
  const tokens = payload?.tokens || {};
  if (!tokens.access_token || !tokens.id_token || !tokens.refresh_token) return null;
  const accountId = codexAccountId(tokens);
  return {
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    tokens: {
      id_token: tokens.id_token,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      ...(accountId ? { account_id: accountId } : {}),
    },
    last_refresh: new Date(payload.saved_at || Date.now()).toISOString(),
  };
}

export async function applyCodexCliAuthToInstance(name: string, options: { required?: boolean } = {}) {
  const auth = await codexCliAuthPayload();
  if (!auth) {
    if (options.required) {
      throw Object.assign(new Error("Codex CLI capability requires a saved Codex device login. Open Fleet settings -> Model & auth, complete Codex device login, then create this agent again."), { status: 409 });
    }
    return { codexCliAuthApplied: false };
  }
  await writePrivateFile(path.join(homeDir(name), ".codex", "auth.json"), `${JSON.stringify(auth, null, 2)}\n`);
  return { codexCliAuthApplied: true };
}

export async function applyGlobalOAuthToInstance(name: string) {
  const payload = await readCodexOAuthPayload();
  if (!payload?.tokens?.access_token) return { oauthCredentialCount: 0 };
  const script = `
import json, sys, uuid
root, home = sys.argv[1:3]
sys.path.insert(0, root)
from agent.credential_pool import AUTH_TYPE_OAUTH, SOURCE_MANUAL, PooledCredential
from hermes_cli.auth import read_credential_pool, write_credential_pool
payload = json.load(sys.stdin)
provider = "openai-codex"
source = f"{SOURCE_MANUAL}:fleet_device_code"
entries = [e for e in read_credential_pool(provider) if e.get("source") != source]
priority = max([int(e.get("priority", -1)) for e in entries] or [-1]) + 1
entry = PooledCredential(provider=provider, id=uuid.uuid4().hex[:6], label=payload.get("label"), auth_type=AUTH_TYPE_OAUTH, priority=priority, source=source, access_token=payload["tokens"]["access_token"], refresh_token=payload["tokens"].get("refresh_token"), base_url=payload.get("base_url"))
entries.append(entry.to_dict())
write_credential_pool(provider, entries)
`;
  await run(await hermesPython(), ["-c", script, HERMES_AGENT_SRC, homeDir(name)], {
    cwd: HERMES_AGENT_SRC,
    env: { HERMES_HOME: homeDir(name) },
    stdin: JSON.stringify(payload),
    timeout: 15000,
  });
  return { oauthCredentialCount: 1 };
}
