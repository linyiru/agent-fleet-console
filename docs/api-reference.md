# API Reference

Fleet exposes an Express JSON API under `/api`. The API is primarily used by the React app, but it is also useful for local automation and diagnostics.

The API is not versioned yet. Treat request and response shapes as project-internal until a stable public API is declared.

## Authentication

When auth is disabled, API routes are open on the bound interface.

When `HERMES_CONSOLE_TOKEN` is set or `HERMES_CONSOLE_REQUIRE_AUTH=1`, every `/api` request must include one of:

```http
Authorization: Bearer <token>
```

or:

```http
x-hermes-console-token: <token>
```

Websocket upgrades accept the bearer header or a query token:

```text
?auth=<token>
?token=<token>
```

Do not expose Fleet without auth.

## Response Conventions

Most successful responses are JSON objects. Errors are JSON with an `error` field:

```json
{
  "error": "Authentication required"
}
```

Long-running operations return `202 Accepted` with a job object:

```json
{
  "job": {
    "id": 1,
    "action": "create",
    "instance": "research-agent",
    "status": "queued",
    "progress": 0
  }
}
```

Poll job status with:

```text
GET /api/jobs/:id
```

## Common Payloads

Create an agent through the Fleet node route:

```http
POST /api/fleet/local/instances
Content-Type: application/json
```

```json
{
  "name": "research-agent",
  "templateId": "personal-assistant",
  "start": true,
  "runtime": "docker",
  "dependencies": {
    "camofox": true
  },
  "capabilities": {
    "codexCli": true,
    "sharedMemory": true
  },
  "contextFiles": {},
  "telegram": {
    "enabled": false
  }
}
```

Run a lifecycle action:

```http
POST /api/fleet/local/instances/research-agent/actions
Content-Type: application/json
```

```json
{
  "action": "restart",
  "confirmed": true,
  "riskConfirmed": true
}
```

Send a chat turn:

```http
POST /api/fleet/local/instances/research-agent/sessions/chat
Content-Type: application/json
```

```json
{
  "sessionId": "",
  "message": "Summarize the current workspace.",
  "executionPolicy": "default"
}
```

## System Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Health, root paths, data dir, app root, console version |
| `GET` | `/api/setup/baseline` | Setup readiness checks |
| `GET` | `/api/security` | Auth status, self-update flag, audit summary |
| `GET` | `/api/events` | Recent events, optional `instance` and `limit` query params |
| `GET` | `/api/jobs` | Recent jobs, optional `limit` query param |
| `GET` | `/api/jobs/:id` | One job by ID |
| `POST` | `/api/jobs/:id/cancel` | Cancel a local job |
| `POST` | `/api/system/git-update-restart` | Start console self-update when enabled |
| `GET` | `/api/system/git-update-restart/status` | Self-update status |

## Fleet Overview And Nodes

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/fleet/overview` | Aggregated local and remote instances, nodes, jobs, and metrics |
| `GET` | `/api/fleet/nodes` | List configured Fleet nodes |
| `POST` | `/api/fleet/nodes` | Create a remote node record |
| `PUT` | `/api/fleet/nodes/:nodeId` | Update a node label, URL, token, or enabled state |
| `DELETE` | `/api/fleet/nodes/:nodeId` | Remove a node record |
| `POST` | `/api/fleet/nodes/:nodeId/test` | Test node reachability |

`/api/fleet/overview?refreshVersions=1` asks nodes to refresh version/update status.

## Fleet Node Proxy Endpoints

These routes work for `local` and remote node IDs. The UI uses these routes for most operations.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/fleet/:nodeId/instances` | Create an agent on a target node |
| `GET` | `/api/fleet/:nodeId/instances/:name` | Read one agent snapshot |
| `PUT` | `/api/fleet/:nodeId/instances/:name/display-name` | Set an agent display name |
| `POST` | `/api/fleet/:nodeId/instances/:name/actions` | Queue start, stop, restart, update, or delete |
| `POST` | `/api/fleet/:nodeId/instances/:name/clone` | Clone an agent on that node |
| `POST` | `/api/fleet/:nodeId/instances/:name/move` | Move an agent to another Fleet node through backup, transfer, restore, verify, and optional source removal |
| `POST` | `/api/fleet/:nodeId/instances/:name/telegram` | Queue Telegram setup for an agent |
| `GET` | `/api/fleet/:nodeId/instances/:name/gateway` | Dashboard, VNC, web, proxy, auth, and diagnostics URLs |
| `GET` | `/api/fleet/:nodeId/instances/:name/terminal-ticket` | Create a terminal websocket ticket |
| `GET` | `/api/fleet/:nodeId/instances/:name/crons` | Read discovered cron entries |
| `GET` | `/api/fleet/:nodeId/instances/:name/credentials` | Read redacted per-agent credential summaries |
| `GET` | `/api/fleet/:nodeId/instances/:name/payment-policy` | Read payment policy |
| `GET` | `/api/fleet/:nodeId/instances/:name/sessions` | List chat sessions |
| `GET` | `/api/fleet/:nodeId/instances/:name/sessions/:sessionId/messages` | List chat messages |
| `POST` | `/api/fleet/:nodeId/instances/:name/sessions/chat` | Send a chat turn |
| `GET` | `/api/fleet/:nodeId/instances/:name/sessions/runs/:runId` | Get chat run status |
| `POST` | `/api/fleet/:nodeId/instances/:name/sessions/runs/:runId/stop` | Stop a chat run |
| `GET` | `/api/fleet/:nodeId/backups` | List backups on a node |
| `GET` | `/api/fleet/:nodeId/backups/:file/download` | Download a backup from a node |
| `POST` | `/api/fleet/:nodeId/backups/export` | Queue backup export on a node |
| `POST` | `/api/fleet/:nodeId/backups/inspect` | Inspect a backup on a node |
| `POST` | `/api/fleet/:nodeId/jobs/:jobId/cancel` | Cancel a remote job |
| `GET` | `/api/fleet/:nodeId/jobs/:jobId` | Read remote job status |
| `POST` | `/api/fleet/:nodeId/console/git-update-restart` | Start remote console self-update |
| `GET` | `/api/fleet/:nodeId/console/git-update-restart/status` | Read remote self-update status |

For remote nodes, the coordinator forwards requests to the node's base URL with its configured bearer token.

## Fleet-Wide Sync

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/fleet/global-config/sync` | Sync provider, credentials, and auth across selected fleet targets |
| `POST` | `/api/fleet/global-config/sync-targets` | Sync explicit targets only |

Target shape:

```json
{
  "targets": [
    {
      "nodeId": "local",
      "name": "research-agent"
    }
  ]
}
```

## Local Instance Endpoints

These routes operate only on the local console host. Prefer Fleet node proxy routes when your automation should work for local and remote nodes.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/instances` | List local instances |
| `POST` | `/api/instances` | Create a local instance |
| `GET` | `/api/instances/:name` | Read one local instance |
| `PUT` | `/api/instances/:name/display-name` | Set display name |
| `POST` | `/api/instances/:name/actions` | Queue lifecycle action |
| `POST` | `/api/instances/:name/clone` | Clone a local instance |
| `POST` | `/api/instances/:name/telegram` | Queue Telegram setup |
| `GET` | `/api/instances/:name/gateway` | Gateway URLs and diagnostics |
| `GET` | `/api/instances/:name/terminal-ticket` | Create terminal websocket ticket |
| `GET` | `/api/instances/:name/crons` | Read cron entries |
| `GET` | `/api/instances/:name/sessions` | List sessions |
| `GET` | `/api/instances/:name/sessions/:sessionId/messages` | Read session messages |
| `POST` | `/api/instances/:name/sessions/chat` | Send chat turn |
| `GET` | `/api/instances/:name/sessions/runs/:runId` | Read chat run status |
| `POST` | `/api/instances/:name/sessions/runs/:runId/stop` | Stop chat run |
| `PUT` | `/api/instances/:name/provider` | Write per-agent provider config |
| `GET` | `/api/instances/:name/credentials` | Read redacted credential summaries |
| `PUT` | `/api/instances/:name/credentials` | Set a per-agent credential |
| `DELETE` | `/api/instances/:name/credentials/:key` | Delete a per-agent credential |
| `GET` | `/api/instances/:name/payment-policy` | Read payment policy |
| `PUT` | `/api/instances/:name/payment-policy` | Write payment policy |

Lifecycle actions accepted by the validator:

```text
create
start
stop
restart
update
delete
```

Create is normally called through `POST /api/instances` or `POST /api/fleet/:nodeId/instances`, not through the actions route.

## Global Config Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/hermes-provider-catalog` | Bundled provider catalog |
| `GET` | `/api/global-config` | Provider, credentials summaries, OAuth, and sync state |
| `PUT` | `/api/global-config/provider` | Save fleet-wide provider default |
| `PUT` | `/api/global-config/credentials` | Set shared credential |
| `DELETE` | `/api/global-config/credentials/:key` | Delete shared credential |
| `POST` | `/api/global-config/oauth/start` | Start provider OAuth device flow |
| `GET` | `/api/global-config/oauth/:provider/:sessionId` | Read OAuth session status |
| `POST` | `/api/global-config/sync` | Queue local global config sync |
| `POST` | `/api/global-config/import` | Import provider/credential bundle metadata |

Provider payload:

```json
{
  "provider": "openrouter",
  "model": "anthropic/claude-sonnet-4.6",
  "baseUrl": "https://openrouter.ai/api/v1",
  "customEndpoints": []
}
```

Credential payload:

```json
{
  "key": "OPENROUTER_API_KEY",
  "value": "replace-with-secret-value"
}
```

## Shared Memory Endpoints

These routes operate on the local console's shared-memory hub and local agents. Remote Fleet nodes manage their own local links through their own console.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/shared-memory` | Hub status, linked-agent state, and supported entry kinds |
| `POST` | `/api/shared-memory/hub` | Start or stop the hub with `{ "action": "start" }` or `{ "action": "stop" }` |
| `GET` | `/api/shared-memory/entries` | List recent entries, or search with `?query=...`; optional `limit` |
| `POST` | `/api/shared-memory/entries` | Add a shared entry as `console` |
| `DELETE` | `/api/shared-memory/entries/:id` | Delete a shared entry |
| `POST` | `/api/shared-memory/agents/:name/link` | Link an agent, install the skill, and restart it if running |
| `DELETE` | `/api/shared-memory/agents/:name/link` | Unlink an agent, remove the skill, and restart it if running |

Add-entry payload:

```json
{
  "content": "Matt prefers concise agent reports.",
  "kind": "preference",
  "importance": 0.8
}
```

Supported kinds are:

```text
meta
preference
correction
identity
```

Link responses indicate whether Fleet reloaded the agent immediately:

```json
{
  "name": "research-agent",
  "linked": true,
  "restarted": true,
  "restartRequired": false
}
```

The same link flow can run during agent creation by setting `capabilities.sharedMemory` to `true` in the create-agent payload. The shared-memory hub exposes only `fleet_shared_memory_*` tools to linked agents. Private agent memory remains available through each agent's own local Mnemosyne tools, not through the shared hub. The distinct Fleet names avoid collisions with local Mnemosyne tools such as `mnemosyne_shared_recall`.

## Codex CLI Capability

Set `capabilities.codexCli` to `true` when creating a Docker Hermes agent to install `@openai/codex` into that agent's persistent home. Fleet writes `/opt/data/.codex/auth.json` from the saved OpenAI Codex device login used by the `openai-codex` provider, so the agent does not need a separate `codex login`.

Local creates return `409` if no Codex device login has been saved in Fleet settings. Remote Fleet nodes validate against their own saved Codex login.

## Template Library Endpoints

Template library archives are reusable, single-agent Docker Hermes captures. They never include secret values. Fleet stores only required secret names and checks the target node before deploy.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/template-library` | List saved templates |
| `POST` | `/api/template-library/capture` | Capture one local Docker agent as a secret-free template |
| `POST` | `/api/template-library/requirements/check` | Check an ad hoc requirements object against the local node |
| `POST` | `/api/template-library/archive/deploy` | Queue target-side deploy from an imported archive path |
| `POST` | `/api/template-library/:id/requirements/check` | Check target-node credentials and OAuth requirements |
| `POST` | `/api/template-library/:id/deploy` | Queue deploy to local or remote Fleet node |
| `DELETE` | `/api/template-library/:id` | Delete a template and its archive |

Capture payload:

```json
{
  "sourceName": "research-agent",
  "name": "Research baseline",
  "description": "Browser and workspace context configured",
  "includeWorkspace": true
}
```

Deploy payload:

```json
{
  "targetNodeId": "local",
  "name": "research-agent-copy",
  "start": true,
  "allowMissingRequirements": false
}
```

Requirement check response:

```json
{
  "ok": false,
  "missing": [
    { "type": "oauth", "key": "openai-codex", "label": "openai-codex device login" },
    { "type": "credential", "key": "TELEGRAM_BOT_TOKEN", "label": "Credential TELEGRAM_BOT_TOKEN" }
  ]
}
```

Deploy returns `409` when requirements are missing and `allowMissingRequirements` is not true. Remote deploy uploads the sanitized archive to the target Fleet node and queues the target node's deploy job.

## Backup Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/backups` | List local backups |
| `GET` | `/api/backups/:file/download` | Download local backup archive |
| `POST` | `/api/backups/export` | Queue local backup export |
| `POST` | `/api/backups/import` | Import a streamed `.tar.gz` archive into the local backup directory |
| `POST` | `/api/backups/inspect` | Inspect a local archive path |
| `POST` | `/api/backups/restore` | Queue restore from local archive path |

Inspect payload:

```json
{
  "archivePath": "/absolute/path/to/backup.tar.gz"
}
```

Restore payloads are validated by the server and can include target names, prefix options, workspace options, and secret handling flags.

Move payload:

```json
{
  "targetNodeId": "workstation-2",
  "includeWorkspace": true,
  "includeSecrets": false,
  "startTarget": true,
  "removeSource": false
}
```

When `removeSource` is true, include the usual risky-action confirmation flags:

```json
{
  "confirmed": true,
  "riskConfirmed": true
}
```

## Telegram Onboarding Endpoints

Local Telegram onboarding:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/telegram/onboarding/start` | Start pairing |
| `GET` | `/api/telegram/onboarding/:pairingId` | Poll pairing status |
| `DELETE` | `/api/telegram/onboarding/:pairingId` | Cancel pairing |

Fleet node proxy Telegram onboarding:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/fleet/:nodeId/telegram/onboarding/start` | Start pairing on target node |
| `GET` | `/api/fleet/:nodeId/telegram/onboarding/:pairingId` | Poll target pairing status |
| `DELETE` | `/api/fleet/:nodeId/telegram/onboarding/:pairingId` | Cancel target pairing |

Start payload:

```json
{
  "botName": "research-agent Hermes"
}
```

## Terminal Websocket

First request a ticket:

```text
GET /api/fleet/local/instances/:name/terminal-ticket
```

Response:

```json
{
  "ticket": "short-lived-ticket",
  "wsUrl": "/api/instances/research-agent/terminal?ticket=short-lived-ticket"
}
```

Then open the websocket URL. Optional query params:

```text
cols=120
rows=36
auth=<console-token>
```

Client-to-server websocket messages:

```json
{
  "type": "input",
  "data": "ls\n"
}
```

Server-to-client messages:

```json
{
  "type": "output",
  "data": "..."
}
```

Status messages use:

```json
{
  "type": "status",
  "status": "connected"
}
```

Remote terminal tickets are requested through the Fleet node proxy route. The coordinator returns `/api/fleet/:nodeId/instances/:name/terminal?...` and proxies that websocket to the remote node's local terminal endpoint.

## Curl Examples

Health:

```bash
curl -H "Authorization: Bearer $HERMES_CONSOLE_TOKEN" \
  http://127.0.0.1:5180/api/health
```

List fleet overview:

```bash
curl -H "Authorization: Bearer $HERMES_CONSOLE_TOKEN" \
  http://127.0.0.1:5180/api/fleet/overview
```

Restart an agent:

```bash
curl -X POST \
  -H "Authorization: Bearer $HERMES_CONSOLE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"restart","confirmed":true,"riskConfirmed":true}' \
  http://127.0.0.1:5180/api/fleet/local/instances/research-agent/actions
```
