export const SHARED_MEMORY_MARKER_BEGIN = "# >>> fleet-shared-memory (managed by Fleet Console) >>>";
export const SHARED_MEMORY_MARKER_END = "# <<< fleet-shared-memory <<<";

export function sharedMemoryConfigBlock(port: number, token: string) {
  return [
    SHARED_MEMORY_MARKER_BEGIN,
    "mcp_servers:",
    ...sharedMemoryServerEntry(port, token, 2),
    SHARED_MEMORY_MARKER_END,
  ].join("\n");
}

function sharedMemoryServerEntry(port: number, token: string, indent: number) {
  const pad = " ".repeat(indent);
  const child = " ".repeat(indent + 2);
  const grandchild = " ".repeat(indent + 4);
  return [
    `${pad}fleet-shared-memory:`,
    `${child}url: "http://host.docker.internal:${port}/sse"`,
    `${child}transport: sse`,
    `${child}headers:`,
    `${grandchild}Authorization: "Bearer ${token}"`,
    `${child}timeout: 120`,
  ];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function indentOf(line: string) {
  return line.match(/^[ \t]*/)?.[0].length || 0;
}

function isContentLine(line: string) {
  const trimmed = line.trim();
  return Boolean(trimmed) && !trimmed.startsWith("#");
}

function removeUnmarkedSharedMemoryServer(config: string) {
  const lines = config.split("\n");
  const output: string[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    const mcpMatch = line.match(/^([ \t]*)mcp_servers\s*:\s*(?:#.*)?$/);
    if (!mcpMatch) {
      output.push(line);
      index += 1;
      continue;
    }

    const parentIndent = mcpMatch[1].length;
    let blockEnd = index + 1;
    while (blockEnd < lines.length) {
      const next = lines[blockEnd];
      if (isContentLine(next) && indentOf(next) <= parentIndent) break;
      blockEnd += 1;
    }

    const block = lines.slice(index + 1, blockEnd);
    const kept: string[] = [];
    for (let blockIndex = 0; blockIndex < block.length;) {
      const child = block[blockIndex];
      const childMatch = child.match(/^([ \t]*)fleet-shared-memory\s*:\s*(?:#.*)?$/);
      if (!childMatch || childMatch[1].length <= parentIndent) {
        kept.push(child);
        blockIndex += 1;
        continue;
      }

      const childIndent = childMatch[1].length;
      blockIndex += 1;
      while (blockIndex < block.length) {
        const next = block[blockIndex];
        if (isContentLine(next) && indentOf(next) <= childIndent) break;
        blockIndex += 1;
      }
    }

    const hasRemainingServer = kept.some((candidate) => isContentLine(candidate) && indentOf(candidate) > parentIndent);
    if (hasRemainingServer) output.push(line, ...kept);
    index = blockEnd;
  }
  return output.join("\n");
}

function hasUnmarkedSharedMemoryServer(config: string) {
  const lines = config.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const mcpMatch = line.match(/^([ \t]*)mcp_servers\s*:\s*(?:#.*)?$/);
    if (!mcpMatch) continue;
    const parentIndent = mcpMatch[1].length;
    for (let blockIndex = index + 1; blockIndex < lines.length; blockIndex += 1) {
      const next = lines[blockIndex];
      if (isContentLine(next) && indentOf(next) <= parentIndent) break;
      const childMatch = next.match(/^([ \t]*)fleet-shared-memory\s*:\s*(?:#.*)?$/);
      if (childMatch && childMatch[1].length > parentIndent) return true;
    }
  }
  return false;
}

export function removeSharedMemoryBlock(config: string) {
  const pattern = new RegExp(`\\n?${escapeRegExp(SHARED_MEMORY_MARKER_BEGIN)}[\\s\\S]*?${escapeRegExp(SHARED_MEMORY_MARKER_END)}\\n?`, "g");
  return removeUnmarkedSharedMemoryServer(config.replace(pattern, "\n")).replace(/\n{3,}/g, "\n\n");
}

function upsertSharedMemoryServerEntry(config: string, port: number, token: string): { ok: true; config: string } | { ok: false; reason: string } {
  const lines = config.split("\n");
  const mcpIndex = lines.findIndex((line) => /^mcp_servers\s*:\s*(?:#.*)?$/.test(line));
  if (mcpIndex === -1) {
    if (/^mcp_servers\s*:/m.test(config)) {
      return { ok: false, reason: "This agent's config.yaml defines mcp_servers in a format Fleet cannot update automatically. Add the fleet-shared-memory entry manually, or convert mcp_servers to block YAML and link again." };
    }
    const base = config.replace(/\s*$/, "\n");
    return { ok: true, config: `${base}\n${sharedMemoryConfigBlock(port, token)}\n` };
  }

  const parentIndent = indentOf(lines[mcpIndex]);
  let blockEnd = mcpIndex + 1;
  while (blockEnd < lines.length) {
    const next = lines[blockEnd];
    if (isContentLine(next) && indentOf(next) <= parentIndent) break;
    blockEnd += 1;
  }
  let insertAt = blockEnd;
  while (insertAt > mcpIndex + 1 && !lines[insertAt - 1].trim()) insertAt -= 1;
  const nextLines = [
    ...lines.slice(0, insertAt),
    ...sharedMemoryServerEntry(port, token, parentIndent + 2),
    ...lines.slice(insertAt),
  ];
  return { ok: true, config: nextLines.join("\n").replace(/\n{3,}/g, "\n\n") };
}

export function upsertSharedMemoryBlock(config: string, block: string): { ok: true; config: string } | { ok: false; reason: string } {
  const stripped = removeSharedMemoryBlock(config);
  const match = block.match(/host\.docker\.internal:(\d+)\/sse[\s\S]*?Authorization: "Bearer ([^"]+)"/);
  if (!match) {
    return { ok: false, reason: "Fleet shared-memory block could not be parsed." };
  }
  return upsertSharedMemoryServerEntry(stripped, Number(match[1]), match[2]);
}

export function isSharedMemoryConfig(config: string) {
  return config.includes(SHARED_MEMORY_MARKER_BEGIN) || hasUnmarkedSharedMemoryServer(config);
}
