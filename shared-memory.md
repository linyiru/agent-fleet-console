# Shared Memory

Fleet shared memory is a second memory surface for linked agents. It does not replace an agent's private Mnemosyne memory.

Each linked agent has two memory paths:

| Memory path | Who can read/write it | Tools | Stored under |
| --- | --- | --- | --- |
| Private agent memory | Only that agent | `mnemosyne_recall`, `mnemosyne_remember`, other normal Mnemosyne tools | `<agent>/home/mnemosyne/` |
| Fleet shared memory | Every linked agent and the Fleet operator | `fleet_shared_memory_recall`, `fleet_shared_memory_remember`, `fleet_shared_memory_forget`, `fleet_shared_memory_stats` | `data/shared-memory/` |

Use private memory for one agent's own continuity. Use shared memory for durable facts that other linked agents should be able to find.

## What The Hub Does

The local Fleet console runs one Docker container named:

```text
hermes-shared-memory-hub
```

That container hosts a Mnemosyne MCP server on port `5190` by default. Override the host port with:

```env
HERMES_SHARED_MEMORY_PORT=5190
```

The hub reuses the existing Hermes agent image, writes its database under `data/shared-memory/db/mnemosyne.db`, and protects every MCP request with a generated bearer token stored in:

```text
data/shared-memory/hub.env
```

The shared hub intentionally exposes only the four `fleet_shared_memory_*` tools. It does not expose private-looking tools such as `mnemosyne_recall` or `mnemosyne_recall_canonical`.

The distinct `fleet_shared_memory_*` names matter. Hermes may also provide local `mnemosyne_shared_*` tools from an agent's own Mnemosyne plugin; those are not Fleet's shared hub. Fleet uses non-colliding names so a linked agent has one clear tool path to the fleet-wide database.

## Linking Agents

Open **Fleet settings -> Shared memory**.

1. Start the hub.
2. Link the agents that should participate.
3. Fleet writes a managed `fleet-shared-memory` MCP entry into each linked agent's `home/config.yaml`, merging into an existing block-style `mcp_servers` section when present.
4. Fleet installs `home/skills/fleet-shared-memory/SKILL.md`.
5. If the agent is running, Fleet restarts it so the MCP tools and skill load immediately. If the agent is stopped, it loads the change next time it starts.

Unlinking reverses the process: Fleet removes the managed config block and skill. Running agents are restarted so the tools disappear from their active context.

For new Docker Hermes agents, you can also select the **Shared memory** capability in the New agent modal. Fleet starts the hub if needed, links the agent during the create job, and installs the same managed skill.

## Agent Behavior

Linked agents keep their normal private memory. They should use private memory when the request is about their own prior context, preferences, or task continuity.

They should use shared memory when the user says things like:

- "check shared memory"
- "what is in fleet memory?"
- "what do the other agents know?"
- "save this where every agent can see it"
- "use the overall memory"

The installed `fleet-shared-memory` skill tells the agent to use `fleet_shared_memory_*` tools for those requests and not to answer shared-memory questions from private or local Mnemosyne tools.

## What Belongs In Shared Memory

Good shared entries are compact, durable, and useful across agents:

- operator preferences
- stable identities or contact points
- workflow ownership
- corrections to stale shared entries
- cross-agent handoffs
- project conventions every linked agent should follow

Avoid storing:

- secrets, tokens, credentials, or passwords
- raw conversation logs
- speculation
- one-off task details only one agent needs
- private context that should remain with one agent

Fleet-written entries are attributed to `console`. Agents are instructed to include their own agent name in `metadata.author` when writing shared memory.

## Operator Controls

The Shared memory settings tab lets operators:

- start or stop the hub
- see which local agents are linked
- link or unlink agents
- browse recent shared entries
- search shared entries semantically
- add entries as `console`
- delete entries by ID

Deleting a shared entry removes it from recall for every linked agent.

## Remote Fleet Nodes

Each Fleet console manages links for the agents on that node. Remote agents can share the same memory hub if their console writes a config block that points to the same hub URL and token.

For trusted LAN or VPN setups:

1. Run the hub on the console that should own the shared database.
2. Keep `data/shared-memory/hub.env` private.
3. Configure other Fleet nodes to point linked agents at that hub URL and bearer token.
4. Link agents from each node's own console.

Do not expose the shared-memory hub to untrusted networks. It is a memory write surface for every linked agent.

## Troubleshooting

If an agent answers from private memory instead of shared memory, check these in order.

1. Confirm the hub is running:

```bash
docker ps --filter name=hermes-shared-memory-hub
```

2. Confirm the agent is linked in **Fleet settings -> Shared memory**.

3. Confirm the agent restarted after linking. The agent log should show only four tools registered from `fleet-shared-memory`. Hermes may prefix them as `mcp_fleet_shared_memory_...`, but the underlying tool names should be:

```text
fleet_shared_memory_remember
fleet_shared_memory_recall
fleet_shared_memory_forget
fleet_shared_memory_stats
```

4. Check the installed skill:

```bash
cat <agent>/home/skills/fleet-shared-memory/SKILL.md
```

It should explicitly say that shared-memory requests must use `fleet_shared_memory_*` tools, not private `mnemosyne_*` tools or local `mnemosyne_shared_*` tools. If the agent log lists many private-looking tools from `fleet-shared-memory`, such as `mcp_fleet_shared_memory_mnemosyne_recall`, the hub is not running the managed launcher.

5. Test the hub directly from the console host:

```bash
docker exec -i hermes-shared-memory-hub /opt/hermes/.venv/bin/python - <<'PY'
from mnemosyne import mcp_tools
print(mcp_tools._handle_shared_recall({"query": "test", "limit": 5}))
PY
```

6. If the hub code changed, restart the hub from **Fleet settings -> Shared memory** or call the hub start action again. Fleet rewrites the launcher and restarts the hub when the managed launcher changes.

## Mental Model

Private memory answers "what does this agent remember?"

Shared memory answers "what has the fleet agreed every linked agent may know?"

That separation is the core safety and usability rule: agents keep their own continuity, and shared memory is only for deliberately shared, durable fleet knowledge.
