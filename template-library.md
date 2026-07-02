# Template Library

The template library stores reusable Docker Hermes agent baselines. A template is a curated, secret-free capture of one agent that can be deployed repeatedly as fresh agents on the local console or a trusted remote Fleet node.

Templates are different from backups:

| Feature | Template library | Backup |
| --- | --- | --- |
| Purpose | Reusable baseline for many future agents | Operational snapshot for restore or move |
| Scope | Exactly one Docker Hermes agent | One or more supported backup scopes |
| Secrets | Never included | Excluded by default, optionally included for trusted backup flows |
| Deploy name | Exact new agent name | Restore can use prefix behavior |
| Runtime state | Fresh ports and runtime identity | Fresh ports and runtime identity |
| Storage | `data/template-library/` plus `template_library` SQLite rows | `data/backups/` |

NemoHermes agents are not captured by the template library. Recreate NemoHermes agents from the normal New agent flow.

## Storage

Template archives are written under the console data directory:

```text
data/template-library/
```

Template metadata is stored in SQLite:

```text
data/fleet.db
table: template_library
```

Each row records the template ID, display name, source agent, source node, archive filename/path, archive size, manifest JSON, requirements JSON, and timestamps.

The archive itself contains:

```text
manifest.json
agents/<source-agent>/home/
agents/<source-agent>/workspace/   # when includeWorkspace is true
```

It does not include the source `compose.yaml` or `instance.env`. Deploy creates those fresh on the target node.

## Capture

Capture is available from:

- **Fleet settings -> Templates**
- **Save as template** in an agent's portability actions

Capture accepts only local Docker Hermes agents. The source agent can be running or stopped as long as its files are present.

The capture service:

1. Reads the source agent snapshot.
2. Derives requirement metadata from `home/.env`, `home/config.yaml`, and capability marker files.
3. Copies sanitized `home/` state.
4. Copies sanitized `workspace/` state when enabled.
5. Writes `manifest.json`.
6. Creates a `.tar.gz` archive in `data/template-library/`.
7. Inserts the metadata row in `template_library`.

## Secret Handling

Templates never include secret values.

The sanitizer omits:

- `home/.env`
- `home/.codex/auth.json` and other `.codex` auth state
- token, password, credential, secret, key, PEM, P12, and PFX-like files
- known auth directories such as `.ssh`, `.aws`, `.azure`, `.gcloud`, `.gnupg`, `.docker`, and `.codex`
- generated workspace folders such as `node_modules`, `.git`, `.cache`, `dist`, `build`, and `logs`
- Fleet shared-memory MCP bearer-token config

Fleet records required metadata only:

- credential key names from the source env, such as `OPENAI_API_KEY` or `TELEGRAM_BOT_TOKEN`
- OAuth provider requirements, such as `openai-codex`
- capability requirements, such as Codex CLI, shared memory, payments, and Telegram

The template manifest must not contain raw tokens, bearer strings, private keys, OAuth refresh tokens, API keys, or per-agent runtime secrets.

## Deploy

Deploy is available from:

- **Fleet settings -> Templates**
- **From template** in the New agent modal

Deploy requires an exact new agent name. Fleet rejects name conflicts before creating files.

The deploy service:

1. Extracts and validates the template archive.
2. Verifies the archive is an `agent-template` with exactly one agent.
3. Checks target-node requirements.
4. Returns `409` if requirements are missing and `allowMissingRequirements` is not true.
5. Creates a fresh Docker Hermes agent on the target node.
6. Restores sanitized home and workspace state.
7. Writes current web instructions.
8. Rehydrates target-side credentials and OAuth state.
9. Relinks shared memory to the target node's shared-memory hub when required.
10. Starts the agent when requested.
11. Installs and verifies post-start capabilities such as Codex CLI and payments.

Codex CLI is never copied from the source agent. If the template requires Codex CLI, the target node must have a saved OpenAI Codex device login. Fleet writes fresh CLI auth from that target login and installs `@openai/codex` in the new agent.

Shared memory is never copied from the source hub. If the template requires shared memory, Fleet removes stale source MCP bearer config and links the new agent to the target node's shared-memory hub. Existing non-Fleet MCP servers in `mcp_servers` are preserved when possible.

## Remote Deploy

For remote targets, the coordinator does not unpack the archive locally on behalf of the remote node.

The coordinator:

1. Checks the remote node's requirements through its Fleet API.
2. Uploads the template archive to the remote node through the archive import endpoint.
3. Calls the remote node's target-side template deploy route with the imported archive path.
4. Returns the remote job annotated with node metadata.

The remote node performs the actual fresh deploy, restore, auth rehydration, capability setup, and start.

## Requirements

Requirement checks compare template metadata with the target node's Fleet settings.

Missing items include:

- global credentials absent from `secrets/global-credentials.env`
- OAuth device logins absent from `secrets/global-oauth/`

Example response:

```json
{
  "ok": false,
  "missing": [
    {
      "type": "oauth",
      "key": "openai-codex",
      "label": "openai-codex device login"
    }
  ]
}
```

Operators can deploy with missing requirements only when they explicitly set `allowMissingRequirements: true`. The resulting agent may need credentials, provider auth, or capability setup before it is useful.

## API

Template library routes:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/template-library` | List saved templates |
| `POST` | `/api/template-library/capture` | Capture one local Docker agent |
| `POST` | `/api/template-library/:id/requirements/check` | Check local or remote deploy requirements |
| `POST` | `/api/template-library/:id/deploy` | Queue deploy to local or remote node |
| `DELETE` | `/api/template-library/:id` | Delete metadata and archive |

Internal target-side deploy route:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/template-library/archive/deploy` | Queue deploy from an imported archive path |

## Troubleshooting

If a restored template agent stays stopped, check the template deploy job:

```text
GET /api/jobs/:id
```

Common causes:

- the target name already exists
- target credentials or OAuth are missing and deploy was not allowed to continue
- Docker deploy failed while creating the fresh compose stack
- a restored config had an MCP layout Fleet could not update automatically
- a post-start capability such as Codex CLI failed to install or authenticate

For shared-memory templates, confirm the restored agent has:

```text
home/config.yaml
home/skills/fleet-shared-memory/SKILL.md
```

The config should point to the target node's hub token, not the source node's old token. The active tool names should be `fleet_shared_memory_*`.
