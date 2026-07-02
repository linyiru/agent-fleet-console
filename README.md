![Fleet readme banner](docs/assets/fleet-banner.svg)

# Fleet

Fleet is a local-first web console for creating, configuring, monitoring, and operating Dockerized Hermes agents across one or more trusted machines.

It is primarily built for Hermes Agent and the NVIDIA-focused Hermes variant, Nemo Hermes. Standard Hermes agents are the default path; Nemo Hermes agents are supported when the `nemohermes` runner is available or automatic installation is enabled.

It gives a single operator view for the parts that become noisy once you run more than one agent: service health, provider defaults, shared credentials, chat sessions, browser sidecars, VNC, terminal access, local web publishing, backups, restores, clones, remote nodes, and setup readiness.

Fleet is designed for technical operators running personal or team-controlled agent infrastructure on a workstation, homelab, VPN, or trusted LAN. Runtime state and secrets stay local by default; the repository keeps source code separate from `.env`, `runtime/`, `data/`, `logs/`, `secrets/`, and `vendor/hermes-agent/`.

## Screenshots

![Fleet dashboard showing agents grouped by host with health and update status](docs/assets/screenshots/fleet-dashboard.jpg)

![Agent gateway modal showing terminal access](docs/assets/screenshots/agent-gateway-terminal.jpg)

## What Fleet Does

- Creates Hermes Docker agents from a repeatable local baseline.
- Creates Nemo Hermes sandbox agents when the `nemohermes` runner is available or auto-install is enabled.
- Coordinates local agents and trusted remote Fleet nodes from the same dashboard.
- Shows agent state, service counts, health, memory readiness, gateway diagnostics, drift, and update status.
- Opens agent chat, session history, dashboard, VNC, local web preview, and container terminal surfaces.
- Saves fleet-wide provider defaults for OpenAI Codex, Ollama, Custom endpoints, and OpenRouter.
- Stores shared provider credentials in ignored local files and syncs them into selected agents.
- Supports Codex device login and controlled sync of Codex auth state into agents.
- Can install Codex CLI into new Docker agents and seed it from the same saved Codex device login.
- Creates Telegram-enabled agents through the onboarding pairing flow.
- Publishes static files from each agent workspace through a per-agent webhost sidecar.
- Backs up, restores, and clones agents while excluding secrets unless an operator explicitly opts in.
- Saves secret-free Docker agent templates that can be redeployed repeatedly to local or remote Fleet nodes.
- Runs release and setup audits that keep runtime state, tokens, logs, and oversized source files out of git.

## Requirements

- Node.js 20+ and npm 10+
- Docker with Docker Compose v2
- git, when Fleet should clone the default Hermes source checkout automatically
- Optional: `nemohermes` on `PATH` for Nemo Hermes sandbox agents

The onboarding screen checks these requirements. From a terminal, run the same check with:

```bash
npm run init:baseline
```

## Quickstart

```bash
npm run setup
npm start
```

Open:

```text
http://127.0.0.1:5180
```

`npm run setup` prepares ignored runtime folders, creates `.env` when missing, fixes executable bits on wrapper scripts, installs npm dependencies when needed, clones the configured Hermes source when it is missing, and runs the baseline check. New env files bind the console to `0.0.0.0` so trusted LAN machines can reach it, and setup prompts for or generates `HERMES_CONSOLE_TOKEN` because LAN-visible consoles must use API auth.

`npm start` runs the baseline check, builds the frontend, and serves the production app from the Express server.

From the console host itself, open `http://127.0.0.1:5180`. From another trusted LAN machine, open `http://<console-lan-ip>:5180` and enter the console token when prompted. To keep Fleet local-only, set `HERMES_CONSOLE_HOST=127.0.0.1` in `.env`.

For active development:

```bash
npm run dev
```

The API runs on `http://127.0.0.1:5180`; the Vite frontend runs on `http://127.0.0.1:5200` and proxies `/api` to the API server. In dev mode, Vite listens on `0.0.0.0` by default so LAN clients redirected by the API can reach the frontend; set `HERMES_CONSOLE_DEV_HOST=127.0.0.1` for local-only development.

## First Run

1. Run `npm run setup`.
2. Open `http://127.0.0.1:5180`.
3. Review setup checks on the onboarding screen.
4. Open **Fleet settings** and choose a provider default.
5. Add shared credentials or complete Codex device login if your selected provider needs auth.
6. Create an agent from the dashboard.
7. Open the agent detail view for chat, lifecycle, gateway, terminal, crons, credentials, and diagnostics.

By default, Fleet clones Hermes source into `vendor/hermes-agent` from `HERMES_AGENT_REPO_URL`. To use a checkout somewhere else, set:

```env
HERMES_AGENT_SRC=/path/to/hermes-agent
```

To disable automatic source download:

```env
HERMES_AGENT_AUTO_CLONE=0
```

## Documentation

- [Documentation index](docs/index.md)
- [Getting started](docs/getting-started.md)
- [Operator guide](docs/operator-guide.md)
- [Shared memory guide](docs/shared-memory.md)
- [Template library guide](docs/template-library.md)
- [Configuration reference](docs/configuration.md)
- [API reference](docs/api-reference.md)
- [Codebase guide](docs/codebase.md)
- [Implementation patterns](docs/patterns.md)
- [Release checklist](docs/release-checklist.md)
- [Security policy](SECURITY.md)
- [Contributing guide](CONTRIBUTING.md)
- [Support guide](SUPPORT.md)

## Common Commands

```bash
npm run setup          # prepare local runtime state and dependencies
npm start              # build and serve the production console
npm run dev            # run API and Vite dev server
npm run init:baseline  # check local setup readiness
npm run check          # TypeScript type check
npm test               # run node test suite
npm run build          # production frontend build
npm run audit:release  # repository hygiene audit
npm run release:check  # full release gate
npm run knip           # unused-code audit
```

Fleet also includes repo-local wrappers:

```bash
bin/hermes-console
bin/hermes-docker status <agent>
bin/hermes-docker logs <agent>
bin/hermes-docker shell <agent>
bin/hermes-docker restart <agent>
bin/hermes-docker update <agent>
bin/hermes-docker delete <agent>
```

Use the UI for normal operation. Use the wrappers when you need a direct terminal escape hatch for local Docker agents.

## Configuration At A Glance

Fleet reads process env first, then these files when present:

1. `runtime/.env`
2. `.env`
3. `HERMES_CONSOLE_ENV_FILE`
4. `<HERMES_INSTANCES_ROOT>/.env` when `HERMES_INSTANCES_ROOT` is external

Existing process environment variables win over `.env` values. If a shell profile, service manager, or `launchctl` export still sets `HERMES_CONSOLE_HOST=127.0.0.1`, Fleet will stay loopback-only even when `.env` says `0.0.0.0`.

The most important local settings are:

```env
HERMES_INSTANCES_ROOT=./runtime
HERMES_DOCKER_BIN=./bin/hermes-docker
HERMES_AGENT_SRC=./vendor/hermes-agent
HERMES_AGENT_AUTO_CLONE=1
HERMES_CAMOFOX_CONTEXT=./docker/camofox
HERMES_WEBHOST_CONTEXT=./docker/webhost
HERMES_CONSOLE_HOST=0.0.0.0
HERMES_CONSOLE_PORT=5180
HERMES_CONSOLE_DATA_DIR=./data
HERMES_CONSOLE_SECRETS_DIR=./secrets
HERMES_CONSOLE_REQUIRE_AUTH=1
```

For a remote Fleet node, the base URL entered in **Fleet settings -> Fleet nodes** should use the remote machine's LAN address, for example `http://192.168.3.232:5180`, plus the same bearer token stored in that remote node's `.env`.

Fleet-wide provider defaults and shared credentials are managed from **Fleet settings** and stored in ignored files:

```text
secrets/global-provider.json
secrets/global-credentials.env
secrets/global-oauth/
secrets/global-sync.json
```

Per-agent config lives under each agent folder:

```text
<agent>/
  home/
    .env
    config.yaml
    SOUL.md
  workspace/
    HERMES_WEB.md
    web/
  instance.env
  compose.yaml
```

See [Configuration reference](docs/configuration.md) for the full environment and storage guide.

## Security Defaults

Fleet binds to `0.0.0.0` by default so trusted LAN Fleet nodes can reach it. Keep API auth enabled and set:

```env
HERMES_CONSOLE_TOKEN=<long-random-token>
HERMES_CONSOLE_REQUIRE_AUTH=1
```

The server refuses non-loopback binds unless `HERMES_CONSOLE_TOKEN` is set. `npm run setup` prompts for or generates a token when LAN binding or required auth needs one. For local-only use, set `HERMES_CONSOLE_HOST=127.0.0.1`.

On startup the console prints a one-click sign-in link (`http://127.0.0.1:5180/?token=...`). Opening it stores the token in that browser and removes it from the address bar, so you never paste the token manually. The same `?token=` parameter works on any console URL you share with a trusted browser.

Treat Fleet as a control plane. It can start and stop containers, open terminals, sync credentials, restore backups, create agents, proxy remote node actions, and optionally run self-update commands. Keep individual Hermes dashboards, Camofox VNC endpoints, and agent webhosts private unless you intentionally protect and expose them.

## Fleet Nodes

Fleet Nodes let one console coordinate other Fleet consoles on trusted machines. Add remote consoles in **Fleet settings -> Fleet nodes** with a label, base URL, optional bearer token, and enabled state.

The dashboard then merges local and remote agents, shows the host for each row, and routes create, start, stop, restart, update, delete, clone, backup, chat, gateway, terminal, and detail actions through the selected node.

Remote node bearer tokens are redacted in API responses but stored locally in `data/fleet.db`; keep `data/` private and use disk encryption on shared machines.

## Shared Memory

Shared memory gives linked agents a second Mnemosyne store they can all recall from and contribute to, alongside their own private memory. Private memory remains per-agent; shared memory is only for durable fleet knowledge that every linked agent may use. It is managed in **Fleet settings -> Shared memory**.

- **Hub** - the console runs a single Mnemosyne MCP server (`hermes-shared-memory-hub` container, default port `5190`, override with `HERMES_SHARED_MEMORY_PORT`). It reuses the existing agent image, protects every request with a generated bearer token, and stores its database under `data/shared-memory/`.
- **Linking an agent** adds a managed `fleet-shared-memory` MCP entry to the agent's `config.yaml` and installs a `skills/fleet-shared-memory` skill that teaches the agent when to recall, what belongs in shared memory, and to attribute its entries. Existing block-style custom MCP servers are preserved when Fleet can merge safely. Running agents restart automatically so the tools load immediately; stopped agents pick it up on next start. New Docker Hermes agents can be linked from the New agent modal by selecting the Shared memory capability. Unlinking removes both cleanly and reloads running agents.
- **Linked agents** keep their private Mnemosyne tools and also get four Fleet MCP tools: `fleet_shared_memory_recall`, `fleet_shared_memory_remember`, `fleet_shared_memory_forget`, and `fleet_shared_memory_stats`. The hub intentionally uses distinct names so agents do not confuse Fleet shared memory with private or local Mnemosyne tools such as `mnemosyne_recall` or `mnemosyne_shared_recall`.
- **Operators** can browse, semantically search, add, and delete entries from the Shared memory tab. Console-written entries are attributed to `console`.

Agents on remote Fleet nodes can join by pointing their console at the same hub URL and token; each node's console manages its own links. See the [Shared memory guide](docs/shared-memory.md) for the memory model, linking flow, and troubleshooting.

## Backups, Restore, And Clone

Fleet writes backups to:

```text
data/backups/
```

Backups include agent config, selected workspace files, provider defaults, and a manifest. Secrets such as `home/.env`, global credentials, OAuth state, token-like files, and generated runtime secrets are excluded unless an operator explicitly enables secret export.

Restore uses a local `.tar.gz` archive path on the console host. Restored agents receive fresh generated ports and runtime secrets. Clone duplicates a local agent into a new name and can optionally include workspace files and local per-agent credentials.

## Template Library

Open **Fleet settings -> Templates** or use **Save as template** from a local Docker agent's portability actions.

Templates are reusable, secret-free single-agent captures stored under:

```text
data/template-library/
```

Template capture excludes `home/.env`, Codex CLI auth, token-like files, credential directories, generated workspace folders, and Fleet shared-memory bearer config. Fleet records required secret names only, then checks the target node before deploy. If a template needs credentials or Codex device login that the target node does not have, deploy returns `409` unless the operator chooses to deploy anyway and finish auth later.

Deploying a template creates a fresh Docker Hermes agent with fresh ports and runtime identity, restores the sanitized home/workspace state, and rehydrates target-side auth and capabilities such as Codex CLI and shared memory from the target Fleet node. See the [Template library guide](docs/template-library.md) for the full capture, sanitization, and remote deploy model.

## Project Layout

```text
bin/                  fleet wrapper scripts used by the app
docker/camofox/       Camofox sidecar image context
docker/webhost/       Node.js static webhost sidecar image context
server/               Express API, services, SQLite, terminal websocket
src/                  React frontend, UI state, styles, shared models
scripts/              setup, baseline, release audit, dev/start orchestration
docs/                 user, operator, API, and maintainer documentation
runtime/              ignored default Hermes instance root
data/                 ignored SQLite database and local control state
logs/                 ignored local process logs
secrets/              ignored global provider credentials and OAuth state
vendor/hermes-agent/  ignored optional Hermes source checkout/package
```

## Releasing

Before publishing or opening a pull request:

```bash
npm run release:check
git status --short
```

For setup, onboarding, Docker, or environment changes, also run:

```bash
npm run init:baseline -- --json
```

The release gate runs type checking, tests, production build, repository hygiene audit, production dependency audit, and unused-code audit. See [Release checklist](docs/release-checklist.md) for the manual review list.
