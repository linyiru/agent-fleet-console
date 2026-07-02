# Codebase Guide

Fleet is a local operator console for Dockerized Hermes agents. The app is split into a React frontend, an Express control plane, repo-local fleet wrapper scripts, and setup scripts that prepare ignored runtime state.

## Runtime Model

```text
src/                  React UI, frontend state, shared frontend models
server/               Express API, services, database, terminal websocket
bin/                  hermes-docker and hermes-console wrappers
scripts/              setup, baseline, release audit, dev/start orchestration
docker/camofox/       sidecar browser image context
docker/webhost/       Node.js static webhost sidecar image context
data/                 ignored SQLite database and local control state
runtime/              ignored default Hermes instance root
logs/                 ignored local process logs
secrets/              ignored global provider credentials and OAuth state
vendor/hermes-agent/  ignored optional Hermes source checkout
```

The committed app defaults to localhost. `.env`, runtime directories, generated credentials, logs, and local Hermes checkouts are machine state and must stay out of git.

## Application Flow

The frontend starts at `src/main.tsx`, renders `App`, and uses `useFleetConsole` as the top-level state controller. `useFleetConsole` loads instances, jobs, global provider config, and setup baseline status through the helpers in `src/controllers/api.ts`.

`FleetDashboard` is the primary screen. It shows onboarding when there are no agents, lists fleet state when agents exist, and opens create/settings/detail flows. The advanced agent modal is lazy-loaded and contains chat, details, lifecycle, jobs, gateway, service, VNC, and terminal surfaces.

`SettingsScreen` owns the fleet-wide settings shell. Provider/model auth, credentials, fleet nodes, and backups are split into tab components so each workflow can keep its own loading, validation, empty, and sync states.

The backend starts in `server/index.ts`. It creates the Express app, attaches the terminal WebSocket upgrade handler, starts listening, and kicks the job processor. `server/app.ts` registers auth, API routes, JSON error handling, static production assets, and the dev frontend redirect.

## Backend Structure

Routes validate inputs and delegate work:

- `server/routes/system.ts` handles health, jobs, events, and setup baseline status.
- `server/routes/instances.ts` handles local agent listing, create/action jobs, gateway, chat/session access, terminal tickets, and per-agent config.
- `server/routes/fleet.ts` handles fleet-node discovery, remote node proxying, aggregate metrics, and remote instance actions.
- `server/routes/global-config.ts` handles fleet-wide provider defaults, credentials, OAuth, and sync.
- `server/routes/backups.ts` handles backup creation, restore, archive import, archive download, and backup cleanup.
- `server/routes/telegram.ts` handles Telegram onboarding and related integration checks.

Services own side effects:

- `jobs.ts` stores queued/running/completed work and runs long Docker/Hermes operations outside request handlers.
- `instances.ts`, `instance-insights.ts`, `compose.ts`, and `web-hosting.ts` read instance state, compose files, ports, memory, web publishing metadata, capabilities, drift, and update status.
- `fleet-nodes.ts`, `gateway.ts`, and `gateway-diagnostics.ts` manage remote node registration, remote requests, URL health, and gateway diagnostics.
- `sessions.ts` talks to the embedded Hermes dashboard/chat endpoints and keeps session behavior isolated from UI code.
- `terminal-tickets.ts`, `terminal.ts`, and `fleet-terminal.ts` provide short-lived local and remote terminal access over WebSocket.
- `global-config.ts`, `templates.ts`, and `oauth.ts` manage ignored provider config and credentials.
- `backups.ts` and `backup-files.ts` manage archive creation, restore, upload/download metadata, and safe filesystem access.
- `telegram-onboarding.ts`, `nemoclaw.ts`, `console-update.ts`, and `camofox-diagnostics.ts` isolate integration, update, and diagnostic workflows.
- `records.ts`, `database.ts`, and `schema.ts` manage SQLite events, jobs, messages, and audit records.
- `baseline.ts` wraps `scripts/init-baseline.mjs --json` for the onboarding setup checks.

## Frontend Structure

Screens live in `src/views/`, shared fleet types live in `src/models/`, and API/state helpers live in `src/controllers/`. Generic UI primitives in `src/components/ui/` should stay domain-neutral.

Settings tabs use the `settingsSection` query param for direct state inspection. Preserve those params when adding tabs or deep links so setup, review, and support workflows can open the exact state being discussed.

Some older/high-churn surfaces exceed the preferred 250-line module size. Treat them as decomposition targets when editing nearby behavior, but split along real workflow boundaries: API access, state hooks, small presentational sections, and shared validation helpers.

## Data And Security

SQLite lives in `data/fleet.db` by default. Runtime credentials live in ignored files: `.env`, `secrets/`, per-agent `home/.env`, and per-agent `instance.env`. API responses must return summaries or redacted values, not raw secrets.

When `HERMES_CONSOLE_TOKEN` or `HERMES_CONSOLE_REQUIRE_AUTH=1` is set, `/api` requires a bearer token. The UI stores the entered console token in browser local storage and sends it on API requests. Gateway terminal access uses an API-issued ticket before opening the WebSocket.

For internet or LAN exposure, run the console behind HTTPS, keep individual Hermes dashboards/VNC endpoints private unless separately protected, and require console auth. Per-agent webhost endpoints bind to LAN by design; agents publish static files from `workspace/web`, with generated guidance in `workspace/HERMES_WEB.md`.

## Setup And Release

`npm run setup` is the new-user path. It creates ignored directories, copies `.env.example` when needed, fixes wrapper executable bits, installs dependencies when needed, and runs baseline checks. `npm start` builds and serves the production app. `npm run dev` starts the API and Vite on localhost.

Before release, run:

```bash
npm run release:check
npm run init:baseline -- --json
```
