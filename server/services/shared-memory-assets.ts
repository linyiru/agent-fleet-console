export const CONTAINER_DB_PATH = "/data/shared/mnemosyne.db";

// Mnemosyne's bundled SSE server registers raw ASGI handlers as Starlette
// request-response endpoints; every request then raises after responding and
// poisons HTTP keep-alive connections. This launcher rebuilds the app with
// correct routing on top of the same mnemosyne tool handlers.
export const HUB_LAUNCHER = `import hmac
import json
import os

import uvicorn
from mcp.server import Server
from mcp.server.sse import SseServerTransport
from mcp.types import TextContent, Tool
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.responses import JSONResponse, Response
from starlette.routing import Mount, Route

from mnemosyne.mcp_tools import get_tool_definitions, handle_tool_call

TOKEN = os.environ.get("MNEMOSYNE_MCP_TOKEN", "").strip()
if not TOKEN:
    raise SystemExit("MNEMOSYNE_MCP_TOKEN is required for the shared memory hub")
TOOL_ALIASES = {
    "fleet_shared_memory_remember": "mnemosyne_shared_remember",
    "fleet_shared_memory_recall": "mnemosyne_shared_recall",
    "fleet_shared_memory_forget": "mnemosyne_shared_forget",
    "fleet_shared_memory_stats": "mnemosyne_shared_stats",
}
SOURCE_TOOL_NAMES = {source: alias for alias, source in TOOL_ALIASES.items()}

transport = SseServerTransport("/messages/")
server = Server("mnemosyne")


def fleet_tool_definition(definition):
    alias = SOURCE_TOOL_NAMES.get(definition.get("name", ""))
    if not alias:
        return None
    rewritten = dict(definition)
    original_description = rewritten.get("description") or ""
    rewritten["name"] = alias
    rewritten["description"] = f"Fleet shared memory: {original_description}"
    return rewritten


@server.list_tools()
async def list_tools():
    tools = []
    for definition in get_tool_definitions():
        rewritten = fleet_tool_definition(definition)
        if rewritten:
            tools.append(Tool(**rewritten))
    return tools


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list:
    try:
        source_name = TOOL_ALIASES.get(name)
        if not source_name:
            return [TextContent(type="text", text=json.dumps({"status": "error", "message": "Only fleet_shared_memory_* tools are exposed by the fleet shared-memory hub."}, indent=2))]
        result = handle_tool_call(source_name, arguments or {})
        return [TextContent(type="text", text=json.dumps(result, indent=2, default=str))]
    except Exception as error:
        return [TextContent(type="text", text=json.dumps({"status": "error", "message": str(error)}, indent=2))]


async def handle_sse(request):
    async with transport.connect_sse(request.scope, request.receive, request._send) as streams:
        await server.run(streams[0], streams[1], server.create_initialization_options())
    return Response()


class BearerTokenMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        headers = {key.decode("latin1").lower(): value.decode("latin1") for key, value in scope.get("headers", [])}
        header = headers.get("authorization", "")
        presented = header[len("Bearer "):].strip() if header.startswith("Bearer ") else ""
        if not presented or not hmac.compare_digest(presented, TOKEN):
            response = JSONResponse({"error": "invalid bearer token"}, status_code=401, headers={"WWW-Authenticate": "Bearer"})
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


app = Starlette(
    routes=[
        Route("/sse", endpoint=handle_sse),
        Mount("/messages/", app=transport.handle_post_message),
    ],
    middleware=[Middleware(BearerTokenMiddleware)],
)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("HUB_PORT", "8377")), log_level="info")
`;

export const LIST_SCRIPT = `
import json, os, pathlib, sqlite3, sys
args = json.loads(sys.argv[1])
db = os.environ.get("MNEMOSYNE_SHARED_DB_PATH", "${CONTAINER_DB_PATH}")
if not pathlib.Path(db).exists():
    print(json.dumps({"total": 0, "entries": []}))
    raise SystemExit(0)
conn = sqlite3.connect(db)
conn.row_factory = sqlite3.Row
total = conn.execute("SELECT COUNT(*) FROM working_memory").fetchone()[0]
rows = conn.execute(
    "SELECT id, content, importance, timestamp, author_id, metadata_json FROM working_memory ORDER BY timestamp DESC LIMIT ?",
    (max(1, min(int(args.get("limit", 100)), 500)),),
).fetchall()
entries = []
for r in rows:
    meta = {}
    try:
        meta = json.loads(r["metadata_json"] or "{}")
    except Exception:
        pass
    entries.append({
        "id": r["id"],
        "content": r["content"],
        "importance": r["importance"],
        "timestamp": r["timestamp"],
        "author": meta.get("author") or r["author_id"] or "",
        "kind": meta.get("surface_kind") or "",
    })
print(json.dumps({"total": total, "entries": entries}))
`;

export const ADD_SCRIPT = `
import json, sys
from mnemosyne import mcp_tools
args = json.loads(sys.argv[1])
result = mcp_tools._handle_shared_remember({
    "content": args["content"],
    "kind": args.get("kind") or "meta",
    "importance": args.get("importance", 0.8),
    "metadata": {"author": args.get("author") or "console"},
})
print(json.dumps(result))
`;

export const SEARCH_SCRIPT = `
import json, sys
from mnemosyne import mcp_tools
args = json.loads(sys.argv[1])
result = mcp_tools._handle_shared_recall({"query": args["query"], "limit": args.get("limit", 20)})
entries = []
for r in result.get("results", []):
    meta = r.get("metadata") or {}
    if not isinstance(meta, dict):
        meta = {}
    entries.append({
        "id": r.get("id") or r.get("memory_id") or "",
        "content": r.get("content") or "",
        "importance": r.get("importance"),
        "timestamp": str(r.get("timestamp") or ""),
        "author": meta.get("author") or r.get("author_id") or "",
        "kind": meta.get("surface_kind") or "",
    })
print(json.dumps({"total": len(entries), "entries": entries, "query": result.get("query", "")}))
`;

export const DELETE_SCRIPT = `
import json, sys
from mnemosyne import mcp_tools
args = json.loads(sys.argv[1])
print(json.dumps(mcp_tools._handle_shared_forget({"memory_id": args["id"]})))
`;

export function skillMarkdown(agentName: string) {
  return `---
name: fleet-shared-memory
description: "Read and write the fleet-wide shared memory. Recall before fleet-relevant tasks; store durable facts other agents should know."
version: 1.0.1
author: Fleet Console
metadata:
  hermes:
    tags: [Memory, Fleet, Collaboration]
---

# Fleet Shared Memory

This agent is linked to the fleet's shared memory: a Mnemosyne store that every linked agent and the fleet operator can read and write. It is separate from your private memory. Use it for knowledge that outlives one agent: fleet-wide facts, cross-agent handoffs, operator preferences, and corrections.

## Tools

Provided by the \`fleet-shared-memory\` MCP server:

- \`fleet_shared_memory_recall\` — semantic search over fleet shared memory. Arguments: \`query\`, optional \`limit\`.
- \`fleet_shared_memory_remember\` — store an entry. Arguments: \`content\`, \`kind\` (one of \`meta\`, \`preference\`, \`correction\`, \`identity\`), \`importance\` (0-1), \`metadata\`.
- \`fleet_shared_memory_forget\` — delete an entry you know to be wrong. Argument: \`memory_id\`.
- \`fleet_shared_memory_stats\` — store statistics.

Hermes may display these with an MCP prefix in logs, such as \`mcp_fleet_shared_memory_fleet_shared_memory_recall\`. That is still the fleet shared-memory tool.

When the user says "shared memory", "fleet memory", "overall memory", "memory all agents can see", or asks you to check what another linked agent may know, use these \`fleet_shared_memory_*\` tools. Do not answer those requests from private tools such as \`mnemosyne_recall\`, \`mnemosyne_recall_canonical\`, scratchpad tools, local profile memory, or local \`mnemosyne_shared_*\` tools. Private memory is only for this agent's own continuity.

## When to recall

- Before starting work that could involve other agents, their responsibilities, or fleet conventions.
- When the user references something you do not know but another agent might have recorded.
- Whenever the user asks what is in shared memory, even if private memory seems relevant.
- Before writing, to avoid duplicating an existing entry.

## When to remember

Store only durable, fleet-relevant facts: decisions, conventions, contact points, recurring schedules, operator preferences, corrections to earlier shared entries. One fact per entry, stated plainly.

Do NOT store: secrets, credentials, tokens, raw conversation logs (rejected automatically), speculation, or anything only relevant to your own tasks (use your private memory for that).

## Etiquette

- Always attribute yourself: include \`"metadata": {"author": "${agentName}"}\` in every \`fleet_shared_memory_remember\` call.
- Prefer correcting over duplicating: if an entry is outdated, store a \`correction\` entry referencing it, or forget it and write the replacement.
- Never delete another agent's entry unless you are certain it is wrong.
`;
}
