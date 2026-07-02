# Configuration Reference

Fleet configuration is environment-driven and local-first. Runtime files, credentials, database files, logs, and cloned Hermes source are ignored by git.

## Environment Loading Order

Fleet starts with process environment variables, then loads env files in this order when present:

1. `runtime/.env`
2. `.env`
3. `HERMES_CONSOLE_ENV_FILE`
4. `<HERMES_INSTANCES_ROOT>/.env` when `HERMES_INSTANCES_ROOT` points outside the default root

Values already present in the process environment are not overwritten by env files. Among env files, the first file that defines a key wins. If Fleet appears to ignore `.env`, check for exported shell variables or service-manager environment values with the same name.

## Path Resolution

Most path values support:

- absolute paths
- paths relative to the repository root
- `~` and `~/...`

Executable values support either an executable name on `PATH` or a path.

## Core Paths

```env
HERMES_INSTANCES_ROOT=./runtime
HERMES_DOCKER_BIN=./bin/hermes-docker
HERMES_AGENT_SRC=./vendor/hermes-agent
HERMES_AGENT_AUTO_CLONE=1
HERMES_AGENT_REPO_URL=https://github.com/NousResearch/hermes-agent.git
HERMES_CAMOFOX_CONTEXT=./docker/camofox
HERMES_WEBHOST_CONTEXT=./docker/webhost
HERMES_WEBHOST_IMAGE=local/hermes-webhost:node20
HERMES_CONTAINER_BIN=/opt/hermes/.venv/bin/hermes
```

`HERMES_INSTANCES_ROOT` is where agent folders are created.

`HERMES_DOCKER_BIN` points to the local wrapper used by the API for Docker agent operations.

`HERMES_AGENT_SRC` points to the Hermes source checkout used when building or updating Docker agents.

`HERMES_AGENT_AUTO_CLONE` controls whether setup clones the source checkout when missing.

`HERMES_CAMOFOX_CONTEXT` and `HERMES_WEBHOST_CONTEXT` point to Docker build contexts committed in this repository.

`HERMES_CONTAINER_BIN` is the Hermes executable path inside agent containers.

## Docker Binding

```env
HERMES_DOCKER_DASHBOARD_HOST_BIND=0.0.0.0
HERMES_DOCKER_WEB_HOST_BIND=0.0.0.0
HERMES_DOCKER_VNC_HOST_BIND=0.0.0.0
```

These values control host binds for per-agent dashboard, static webhost, and VNC services created by `bin/hermes-docker`.

Binding agent endpoints to LAN interfaces can expose agent surfaces. Protect the network and keep sensitive workspaces private.

## Console Server

```env
HERMES_CONSOLE_HOST=0.0.0.0
HERMES_CONSOLE_PORT=5180
HERMES_CONSOLE_DATA_DIR=./data
HERMES_CONSOLE_DB=./data/fleet.db
HERMES_CONSOLE_SECRETS_DIR=./secrets
```

`HERMES_CONSOLE_HOST` and `HERMES_CONSOLE_PORT` control the Express server bind.

`HERMES_CONSOLE_DATA_DIR` stores SQLite state, backups, jobs, events, node records, and local control data.

`HERMES_CONSOLE_DB` points to the SQLite database.

`HERMES_CONSOLE_SECRETS_DIR` stores global provider credentials and OAuth state.

## Console Auth

```env
HERMES_CONSOLE_TOKEN=
HERMES_CONSOLE_REQUIRE_AUTH=1
HERMES_CONSOLE_GATEWAY_TICKET_TTL_MS=600000
```

When `HERMES_CONSOLE_REQUIRE_AUTH=1`, all `/api` routes require a bearer token.

When `HERMES_CONSOLE_HOST` is not loopback, `HERMES_CONSOLE_TOKEN` is required even if `HERMES_CONSOLE_REQUIRE_AUTH` is not explicitly set.

The web UI stores the entered token in browser local storage and sends it with API requests.

Terminal websocket access uses an API-issued ticket. Tickets are short-lived and single-use.

## Self Update

```env
HERMES_CONSOLE_ALLOW_SELF_UPDATE=0
HERMES_CONSOLE_RESTART_COMMAND=
HERMES_CONSOLE_UPDATE_TIMEOUT_MS=600000
HERMES_CONSOLE_BUILD_TIMEOUT_MS=1800000
HERMES_CONSOLE_UPDATE_CHECK_TTL_MS=300000
```

Self-update is disabled by default. When enabled, Fleet can run git/npm update operations and restart the console process. Enable it only on trusted admin-only deployments.

`HERMES_CONSOLE_RESTART_COMMAND` can provide a host-specific restart command for process managers.

## Development Server

```env
HERMES_CONSOLE_API_PORT=5180
HERMES_CONSOLE_DEV_FRONTEND_PORT=5200
HERMES_CONSOLE_DEV_HOST=0.0.0.0
HERMES_CONSOLE_DEV_HMR_HOST=
HERMES_CONSOLE_DEV_FRONTEND_URL=http://localhost:5200
```

`npm run dev` sets the API port and frontend URL. Vite reads the frontend host and port from `vite.config.ts`. When `HERMES_CONSOLE_DEV_HMR_HOST` is empty, Vite uses the page host for hot-module websocket connections; set it only when a proxy or tunnel requires a fixed HMR hostname.

## Chat Limits

```env
HERMES_CONSOLE_MAX_CHAT_MESSAGE_CHARS=100000
HERMES_CONSOLE_MAX_CONTEXT_FILE_CHARS=20000
```

These limits protect API payload size for chat messages and create-time context files.

## Local Model Host Normalization

```env
HERMES_NORMALIZE_LOCAL_MODEL_HOSTS=1
```

When enabled, Fleet normalizes local provider base URLs so containerized agents can reach host-machine services such as Ollama.

## NemoHermes

```env
NEMOHERMES_BIN=nemohermes
NEMOHERMES_AUTO_INSTALL=1
NEMOHERMES_INSTALL_COMMAND=curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash
NEMOHERMES_INSTALL_TIMEOUT_MS=300000
```

`NEMOHERMES_BIN` can be a command on `PATH` or an absolute path.

If the runner is missing and auto-install is enabled, Fleet tries `NEMOHERMES_INSTALL_COMMAND` during create. Set `NEMOHERMES_AUTO_INSTALL=0` on locked-down hosts.

## Camofox

```env
CAMOFOX_VERSION=1.11.2
```

The Docker wrapper uses this value for the local Camofox browser sidecar image tag:

```text
local/camofox-browser:<CAMOFOX_VERSION>
```

## Provider Defaults

Fleet-wide provider defaults are stored in:

```env
HERMES_GLOBAL_PROVIDER_FILE=./secrets/global-provider.json
```

Default content shape:

```json
{
  "provider": "openai-codex",
  "model": "gpt-5.5",
  "baseUrl": "https://chatgpt.com/backend-api/codex",
  "customEndpoints": []
}
```

Bundled provider IDs:

```text
openai-codex
ollama
custom
openrouter
```

Agent sync writes provider data into:

```text
<agent>/home/config.yaml
```

## Shared Credentials

```env
HERMES_GLOBAL_CREDENTIALS_FILE=./secrets/global-credentials.env
```

Example shape:

```env
OPENAI_API_KEY=...
OPENROUTER_API_KEY=...
```

Credential keys must pass validation. Fleet rejects keys that can alter runtime loading or process behavior, such as `PATH`, `NODE_OPTIONS`, `PYTHONPATH`, and dynamic-loader variables.

Agent sync writes shared credentials into:

```text
<agent>/home/.env
```

## OAuth State

```env
HERMES_GLOBAL_OAUTH_DIR=./secrets/global-oauth
HERMES_GLOBAL_SYNC_FILE=./secrets/global-sync.json
```

Codex device login stores auth state under the OAuth directory. Sync metadata is stored in the sync file.

When a Docker Hermes agent is created with the Codex CLI capability, Fleet derives the CLI auth file from that same saved device login:

```text
<agent>/home/.codex/auth.json
```

The CLI itself is installed into the agent home under `<agent>/home/.npm-global/`, with a stable wrapper at `<agent>/home/bin/codex`.

## Agent Directory Layout

A Docker agent typically has:

```text
<agent>/
  compose.yaml
  instance.env
  home/
    .env
    config.yaml
    SOUL.md
  workspace/
    HERMES_WEB.md
    web/
```

`compose.yaml` and `instance.env` are generated runtime state. Restores generate fresh ports and runtime secrets rather than reusing them blindly.

`home/.env` contains per-agent credentials.

`home/config.yaml` contains provider and model config.

`home/SOUL.md` stores the selected agent template.

`workspace/web/` is served by the agent webhost sidecar.

## Fleet Nodes Storage

Remote Fleet node records live in SQLite:

```text
data/fleet.db
```

Remote tokens are stored locally so the coordinator can poll and proxy actions. Tokens are redacted in API responses but plaintext at rest in the database. Keep `data/` private.

## Shared Memory Storage

Fleet shared memory is stored separately from each agent's private memory.

Per-agent private memory lives under the agent home, for example:

```text
<agent>/home/mnemosyne/
```

Fleet shared memory lives under the console data directory:

```text
data/shared-memory/
  hub.env
  hub-launcher.py
  db/mnemosyne.db
  cache/
```

`hub.env` contains the generated bearer token used by linked agents to reach the shared-memory hub. Keep it private.

`db/mnemosyne.db` is the shared store that every linked agent can read from and write to through `fleet_shared_memory_*` tools.

The hub listens on port `5190` by default:

```env
HERMES_SHARED_MEMORY_PORT=5190
```

Agents are linked by adding a managed `fleet-shared-memory` entry to `<agent>/home/config.yaml` and installing `<agent>/home/skills/fleet-shared-memory/SKILL.md`. If `mcp_servers` already contains other block-style MCP servers, Fleet preserves them and merges its own entry. Running agents restart automatically after link or unlink so the active process sees the change.

## Backups

Backups are stored under:

```text
data/backups/
```

Backup export can include selected agents, selected workspace content, provider defaults, and a manifest. Secret export is opt-in.

Restore validates archive entries before extraction and rejects absolute paths, parent traversal, symlinks, and hardlinks.

## Template Library

Reusable Docker agent templates are stored under:

```text
data/template-library/
```

Metadata is stored in the local SQLite database in `template_library`.

Templates are stricter than backups. They are always secret-free and omit:

- `home/.env`
- Codex CLI auth files
- token-like and credential-like files
- known auth directories
- generated workspace folders
- managed Fleet shared-memory bearer-token config

The template manifest records required credential key names and OAuth provider names only. Deploy checks those requirements against the target node's current Fleet settings before creating the new agent.

## Example Local-Only `.env`

```env
HERMES_INSTANCES_ROOT=./runtime
HERMES_AGENT_SRC=./vendor/hermes-agent
HERMES_AGENT_AUTO_CLONE=1
HERMES_CONSOLE_HOST=127.0.0.1
HERMES_CONSOLE_PORT=5180
HERMES_CONSOLE_DATA_DIR=./data
HERMES_CONSOLE_SECRETS_DIR=./secrets
HERMES_CONSOLE_REQUIRE_AUTH=0
```

## Example Trusted LAN Node `.env`

```env
HERMES_INSTANCES_ROOT=./runtime
HERMES_AGENT_SRC=./vendor/hermes-agent
HERMES_CONSOLE_HOST=0.0.0.0
HERMES_CONSOLE_PORT=5180
HERMES_CONSOLE_TOKEN=replace-with-a-long-random-token
HERMES_CONSOLE_REQUIRE_AUTH=1
```

Use HTTPS or a trusted VPN for remote access. Keep individual agent dashboards and VNC endpoints off untrusted networks.
