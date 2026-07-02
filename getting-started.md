# Getting Started

This guide gets Fleet running from a fresh clone and explains what setup changes on disk.

## Requirements

Install:

- Node.js 20 or newer
- npm 10 or newer
- Docker with Docker Compose v2
- git, if Fleet should clone Hermes source automatically

Optional:

- `nemohermes`, when you want to create NemoHermes sandbox agents without auto-install

## Fresh Clone

From the repository root:

```bash
npm run setup
npm start
```

Open:

```text
http://127.0.0.1:5180
```

The default generated config binds the production server to `0.0.0.0` so trusted LAN machines can use this console as a Fleet node. On the host itself, keep opening `http://127.0.0.1:5180`; from another trusted LAN machine, use `http://<console-lan-ip>:5180`.

Because the default bind is LAN-visible, setup requires `HERMES_CONSOLE_TOKEN` and `HERMES_CONSOLE_REQUIRE_AUTH=1`. If no token exists yet, `npm run setup` prompts for one or generates one automatically.

## What Setup Does

`npm run setup` runs `scripts/setup-baseline.mjs`. It:

- creates `runtime/`, `data/`, `logs/`, `secrets/`, and `vendor/` when missing
- creates `.env` when missing
- fixes executable bits on `bin/hermes-docker` and `bin/hermes-console`
- installs npm dependencies when `node_modules/` is missing
- clones `HERMES_AGENT_REPO_URL` into `HERMES_AGENT_SRC` when source is missing and auto-clone is enabled
- prompts for `HERMES_CONSOLE_TOKEN` if auth or LAN binding requires one
- runs a final setup baseline check

The generated `.env` is local machine state and is ignored by git.

Setup does not overwrite an existing `.env` unless you explicitly force it:

```bash
npm run setup:baseline -- --force-env
```

If an existing `.env` still has `HERMES_CONSOLE_HOST=127.0.0.1`, edit it to `HERMES_CONSOLE_HOST=0.0.0.0` before using the machine as a remote Fleet node.

## Baseline Check

Run:

```bash
npm run init:baseline
```

For machine-readable output:

```bash
npm run init:baseline -- --json
```

The check reports readiness for Node, npm, Docker, Docker Compose, npm dependencies, env files, auth settings, instance root, wrapper scripts, NemoHermes, Docker contexts, Hermes source, and data directories.

Warnings do not always block Fleet from running. For example, missing NemoHermes only matters when creating NemoHermes sandbox agents.

## Production Mode

```bash
npm start
```

This command:

1. runs setup baseline checks
2. builds the Vite frontend into `dist/`
3. starts the Express server with `tsx server/index.ts`

The production app serves both the API and built frontend from:

```text
http://127.0.0.1:5180
```

That URL is the local browser address. LAN clients use the host's LAN address on the same port, for example `http://192.168.3.232:5180`. Set `HERMES_CONSOLE_PORT` to use a different port.

## Development Mode

```bash
npm run dev
```

Development mode runs two processes:

```text
API:      http://127.0.0.1:5180
Frontend: http://127.0.0.1:5200
```

Those are the local browser URLs. By default, Vite binds to `0.0.0.0` so LAN clients can follow API redirects to `http://<console-lan-ip>:5200`; set `HERMES_CONSOLE_DEV_HOST=127.0.0.1` to keep the dev frontend local-only.

Vite proxies `/api` and websocket traffic to the API server. Useful environment values:

```env
HERMES_CONSOLE_API_PORT=5180
HERMES_CONSOLE_DEV_FRONTEND_PORT=5200
HERMES_CONSOLE_DEV_HOST=0.0.0.0
HERMES_CONSOLE_DEV_HMR_HOST=
```

## Existing Hermes Agents

If you already have an instance root, point Fleet at it:

```env
HERMES_INSTANCES_ROOT=/path/to/hermes-instances
```

If your Hermes source checkout is elsewhere:

```env
HERMES_AGENT_SRC=/path/to/hermes-agent
```

When `HERMES_INSTANCES_ROOT` is external, Fleet also loads:

```text
<HERMES_INSTANCES_ROOT>/.env
```

Use that only for shared instance-root configuration. Keep host-specific console settings in this repository's `.env`.

Process environment variables have priority over env files. If a shell profile, process manager, or macOS `launchctl` environment still exports `HERMES_CONSOLE_HOST=127.0.0.1`, Fleet will remain local-only until that exported value is removed or changed.

## LAN Or Reverse Proxy Access

The default generated config is LAN-visible for Fleet node coordination:

```env
HERMES_CONSOLE_HOST=0.0.0.0
HERMES_CONSOLE_TOKEN=<long-random-token>
HERMES_CONSOLE_REQUIRE_AUTH=1
```

For local-only use, switch back to:

```env
HERMES_CONSOLE_HOST=127.0.0.1
```

The server refuses non-loopback binds when `HERMES_CONSOLE_TOKEN` is empty. `npm run setup` can generate a token when one is required.

After changing bind or auth settings, restart Fleet and confirm the server is listening on all interfaces:

```bash
lsof -nP -iTCP:5180 -sTCP:LISTEN
```

The listener should show `*:5180` or `0.0.0.0:5180`. If it still shows `127.0.0.1:5180`, check for an existing `.env` value or exported machine environment variable.

Recommended reverse-proxy target:

```text
http://127.0.0.1:5180
```

## Creating Your First Agent

1. Open the dashboard.
2. Open **Fleet settings**.
3. Pick a model provider.
4. Add provider credentials or complete Codex device login.
5. Save the provider configuration.
6. Click **New agent**.
7. Choose the target node, runtime, name, dependencies, and optional Telegram setup.
8. Wait for the create job to complete.

Agent names use lowercase letters, numbers, hyphens, and underscores for Docker agents. NemoHermes sandbox names use lowercase letters, numbers, and hyphens.

## Troubleshooting First Run

Run:

```bash
npm run init:baseline
```

Then check:

- Docker Desktop or Docker Engine is running.
- `docker compose version` succeeds.
- `.env` exists and points to valid paths.
- `bin/hermes-docker` is executable.
- `HERMES_AGENT_SRC` points to a valid Hermes checkout or auto-clone is enabled.
- `HERMES_CONSOLE_TOKEN` is set when binding outside localhost.
- `HERMES_CONSOLE_HOST=0.0.0.0` is active when the machine should be reachable as a remote Fleet node.

For direct local Docker inspection:

```bash
bin/hermes-docker status <agent>
bin/hermes-docker logs <agent>
```
