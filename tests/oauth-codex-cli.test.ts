import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function jwt(claims: Record<string, unknown>) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(claims)}.signature`;
}

test("Codex CLI auth payload derives account id from ID token claims", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fleet-codex-oauth-"));
  const previousOauthDir = process.env.HERMES_GLOBAL_OAUTH_DIR;
  process.env.HERMES_GLOBAL_OAUTH_DIR = root;
  try {
    const { codexCliAuthPayload } = await import(`../server/services/oauth.ts?case=${Date.now()}`);

    await fs.writeFile(path.join(root, "openai-codex.json"), JSON.stringify({
      provider: "openai-codex",
      label: "test login",
      base_url: "https://chatgpt.com/backend-api/codex",
      saved_at: "2026-07-02T10:00:00.000Z",
      tokens: {
        id_token: jwt({
          "https://api.openai.com/auth": {
            chatgpt_account_id: "workspace-from-id-token",
            chatgpt_user_id: "user-1",
          },
        }),
        access_token: jwt({
          "https://api.openai.com/auth": {
            chatgpt_account_id: "workspace-from-access-token",
          },
        }),
        refresh_token: "refresh-token",
      },
    }));

    assert.deepEqual(await codexCliAuthPayload(), {
      auth_mode: "chatgpt",
      OPENAI_API_KEY: null,
      tokens: {
        id_token: jwt({
          "https://api.openai.com/auth": {
            chatgpt_account_id: "workspace-from-id-token",
            chatgpt_user_id: "user-1",
          },
        }),
        access_token: jwt({
          "https://api.openai.com/auth": {
            chatgpt_account_id: "workspace-from-access-token",
          },
        }),
        refresh_token: "refresh-token",
        account_id: "workspace-from-id-token",
      },
      last_refresh: "2026-07-02T10:00:00.000Z",
    });
  } finally {
    if (previousOauthDir === undefined) {
      delete process.env.HERMES_GLOBAL_OAUTH_DIR;
    } else {
      process.env.HERMES_GLOBAL_OAUTH_DIR = previousOauthDir;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});
