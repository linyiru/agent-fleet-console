# Fleet Documentation

Fleet is a local-first control plane for Dockerized Hermes agents and trusted remote Fleet nodes. This documentation covers installation, operation, configuration, API usage, and maintainer workflows.

## Guide Map

- [Getting started](getting-started.md): requirements, setup, first run, development mode, existing agents, and baseline checks.
- [Operator guide](operator-guide.md): daily dashboard workflows, creating agents, provider sync, chat, gateway tools, web publishing, template library, backups, Fleet nodes, Telegram, and NemoHermes.
- [Shared memory](shared-memory.md): private agent memory versus fleet shared memory, linking behavior, tools, operator controls, and troubleshooting.
- [Template library](template-library.md): reusable Docker agent captures, storage, sanitization, requirements, deploy behavior, remote deploy, and troubleshooting.
- [Configuration reference](configuration.md): environment loading, important variables, local storage, secrets, provider files, agent files, and deployment examples.
- [API reference](api-reference.md): auth model, response conventions, local API endpoints, Fleet node proxy endpoints, and websocket terminal tickets.
- [Codebase guide](codebase.md): frontend, backend, services, data, and release architecture.
- [Implementation patterns](patterns.md): conventions for changing frontend, backend, settings, release, and security behavior.
- [Release checklist](release-checklist.md): release gate, manual review, runtime-state audit, and required public project files.

## App Shape

Fleet has four main parts:

```text
React UI      Dashboard, settings, agent detail, chat, gateway, backups
Express API   Local control plane, routes, auth, terminal websocket, jobs
Services      Docker/Hermes reads and writes, SQLite records, backup files
Wrappers      bin/hermes-docker and bin/hermes-console for local operations
```

The app keeps source code and local runtime state separate. The following paths are intentionally ignored:

```text
.env
data/
logs/
runtime/
secrets/
vendor/hermes-agent/
```

## Normal Operator Flow

1. Run `npm run setup`.
2. Start Fleet with `npm start`.
3. Open `http://127.0.0.1:5180`.
4. Use setup checks to confirm Docker, Compose, Node, wrappers, data folders, and Hermes source readiness.
5. Configure model and auth defaults in **Fleet settings**.
6. Create one or more agents.
7. Operate agents from dashboard rows and agent detail views.

## Security Model

Fleet binds to `0.0.0.0` by default so trusted LAN Fleet nodes can reach it. It should be treated as an administrator control plane because it can create containers, stop containers, open terminals, sync credentials, restore backups, and proxy actions to remote nodes.

Keep API auth enabled and set:

```env
HERMES_CONSOLE_TOKEN=<long-random-token>
HERMES_CONSOLE_REQUIRE_AUTH=1
```

Remote Fleet nodes are intended for trusted LANs or VPNs. Remote bearer tokens are redacted in API responses but stored locally in `data/fleet.db`, so keep the data directory private.

## Command Shortlist

```bash
npm run setup
npm start
npm run dev
npm run init:baseline
npm run release:check
bin/hermes-docker status <agent>
bin/hermes-docker shell <agent>
```

Use the README as the GitHub front door and these docs when you need exact workflow or implementation detail.
