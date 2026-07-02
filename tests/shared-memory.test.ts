import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isSharedMemoryConfig,
  removeSharedMemoryBlock,
  SHARED_MEMORY_MARKER_BEGIN,
  SHARED_MEMORY_MARKER_END,
  sharedMemoryConfigBlock,
  upsertSharedMemoryBlock,
} from "../server/services/shared-memory-config.ts";

const BASE_CONFIG = "model:\n  provider: openai-codex\nmemory:\n  memory_enabled: true\n";

test("sharedMemoryConfigBlock renders a marked mcp_servers block", () => {
  const block = sharedMemoryConfigBlock(5190, "secret-token");
  assert.ok(block.startsWith(SHARED_MEMORY_MARKER_BEGIN));
  assert.ok(block.endsWith(SHARED_MEMORY_MARKER_END));
  assert.match(block, /url: "http:\/\/host\.docker\.internal:5190\/sse"/);
  assert.match(block, /Authorization: "Bearer secret-token"/);
  assert.match(block, /transport: sse/);
});

test("upsertSharedMemoryBlock appends the block to a clean config", () => {
  const block = sharedMemoryConfigBlock(5190, "tok");
  const result = upsertSharedMemoryBlock(BASE_CONFIG, block);
  assert.ok(result.ok);
  if (result.ok) {
    assert.ok(result.config.includes(BASE_CONFIG.trim()));
    assert.ok(result.config.includes(block));
    assert.ok(isSharedMemoryConfig(result.config));
  }
});

test("upsertSharedMemoryBlock is idempotent and refreshes an existing block", () => {
  const first = upsertSharedMemoryBlock(BASE_CONFIG, sharedMemoryConfigBlock(5190, "old-token"));
  assert.ok(first.ok);
  const second = upsertSharedMemoryBlock(first.ok ? first.config : "", sharedMemoryConfigBlock(5191, "new-token"));
  assert.ok(second.ok);
  if (second.ok) {
    assert.ok(!second.config.includes("old-token"));
    assert.ok(second.config.includes("new-token"));
    assert.equal(second.config.match(/mcp_servers:/g)?.length, 1);
  }
});

test("upsertSharedMemoryBlock merges into configs with an existing mcp_servers block", () => {
  const config = `${BASE_CONFIG}mcp_servers:\n  custom:\n    command: uvx\n`;
  const result = upsertSharedMemoryBlock(config, sharedMemoryConfigBlock(5190, "tok"));
  assert.ok(result.ok);
  if (result.ok) {
    assert.match(result.config, /custom:\n    command: uvx/);
    assert.match(result.config, /fleet-shared-memory:\n    url: "http:\/\/host\.docker\.internal:5190\/sse"/);
    assert.equal(result.config.match(/^mcp_servers:/gm)?.length, 1);
  }
});

test("removeSharedMemoryBlock restores the original config", () => {
  const applied = upsertSharedMemoryBlock(BASE_CONFIG, sharedMemoryConfigBlock(5190, "tok"));
  assert.ok(applied.ok);
  const removed = removeSharedMemoryBlock(applied.ok ? applied.config : "");
  assert.equal(removed.trim(), BASE_CONFIG.trim());
  assert.ok(!isSharedMemoryConfig(removed));
});

test("removeSharedMemoryBlock removes unmarked fleet shared-memory config", () => {
  const config = `${BASE_CONFIG}mcp_servers:\n  fleet-shared-memory:\n    url: http://host.docker.internal:5190/sse\n    transport: sse\n    headers:\n      Authorization: Bearer leaked-token\n    timeout: 120\nplugins:\n  enabled: []\n`;
  assert.ok(isSharedMemoryConfig(config));
  const removed = removeSharedMemoryBlock(config);
  assert.ok(!removed.includes("leaked-token"));
  assert.ok(!removed.includes("fleet-shared-memory"));
  assert.ok(!/^mcp_servers\s*:/m.test(removed));
  assert.match(removed, /plugins:\n  enabled: \[\]/);
  assert.ok(!isSharedMemoryConfig(removed));
});

test("removeSharedMemoryBlock preserves other mcp servers", () => {
  const config = `${BASE_CONFIG}mcp_servers:\n  custom:\n    command: uvx\n  fleet-shared-memory:\n    url: http://host.docker.internal:5190/sse\n    headers:\n      Authorization: Bearer leaked-token\nsettings:\n  ok: true\n`;
  const removed = removeSharedMemoryBlock(config);
  assert.match(removed, /^mcp_servers:\n  custom:\n    command: uvx/m);
  assert.match(removed, /settings:\n  ok: true/);
  assert.ok(!removed.includes("fleet-shared-memory"));
  assert.ok(!removed.includes("leaked-token"));
});

test("removeSharedMemoryBlock leaves untouched configs alone", () => {
  assert.equal(removeSharedMemoryBlock(BASE_CONFIG), BASE_CONFIG);
});
