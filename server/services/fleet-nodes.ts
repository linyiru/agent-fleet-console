import crypto from "node:crypto";
import { db } from "../database.ts";
import { validators } from "../config.ts";
import { cancelJob, createJob, getJob, recentJobs } from "./jobs.ts";
import { credentialSummaries, instanceSnapshot, listInstances } from "./instances.ts";
import { fleetInstanceDisplayName, setFleetInstanceDisplayName, setInstanceDisplayName } from "./instance-meta.ts";
import { nowIso } from "../lib/time.ts";
import { globalConfig, exportGlobalConfigBundle } from "./global-config.ts";
import { chatRunStatus, prepareChatTurn, sessionMessages, listSessions, stopChatRun } from "./sessions.ts";
import { createTerminalTicket } from "./terminal-tickets.ts";
import { readPaymentPolicy } from "./payment-policy.ts";
import { inspectBackup, listBackups } from "./backups.ts";
import { safeArchivePath } from "./backup-files.ts";
import { consoleGitUpdateStatus, startConsoleGitUpdateRestart } from "./console-update.ts";
import { consoleVersion } from "./console-version.ts";
import { updateInfoForRevision } from "./instance-insights.ts";
import { readCronEntries } from "./crons.ts";
import { cancelTelegramOnboarding, startTelegramOnboarding, telegramOnboardingStatus } from "./telegram-onboarding.ts";
import { gatewayResponseForInstance } from "./gateway.ts";
import { diagnoseGatewayEndpoints, isRemoteDashboardAuthError, normalizeRemoteGatewayEndpoints, normalizeRemoteInstanceEndpoints } from "./gateway-diagnostics.ts";
import { codexCliAuthPayload } from "./oauth.ts";

const LOCAL_NODE = {
  id: "local",
  label: "Local Docker",
  baseUrl: "http://127.0.0.1:5180",
  enabled: true,
  local: true,
  status: "online",
  error: "",
  tokenConfigured: false,
  redactedToken: "",
};

function localNode() {
  return { ...LOCAL_NODE, console: consoleVersion() };
}

type FleetNodeRecord = {
  id: string;
  label: string;
  base_url: string;
  auth_token: string;
  enabled: number;
  created_at: string;
  updated_at: string;
};

function slugifyNodeId(value: string) {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "").slice(0, 40);
  return slug || `node-${crypto.randomUUID().slice(0, 8)}`;
}

function normalizeBaseUrl(value: unknown) {
  const text = String(value || "").trim();
  if (!text) throw badRequest("Base URL is required");
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("invalid");
    return url.toString().replace(/\/+$/, "");
  } catch {
    throw badRequest("Invalid Fleet node URL");
  }
}

function badRequest(message: string) {
  const error = new Error(message) as Error & { status?: number };
  error.status = 400;
  return error;
}

function normalizeNodePayload(input: any, existing?: FleetNodeRecord) {
  const label = String(input?.label ?? existing?.label ?? "").trim().slice(0, 80);
  if (!label) throw badRequest("Node label is required");
  const baseUrl = normalizeBaseUrl(input?.baseUrl ?? existing?.base_url ?? "");
  const authToken = input?.authToken === undefined ? existing?.auth_token || "" : String(input.authToken || "").trim();
  if (/[\r\n\0]/.test(authToken)) throw badRequest("Auth token must be a single line");
  return {
    label,
    baseUrl,
    authToken,
    enabled: input?.enabled !== false,
  };
}

function rowToNode(row: FleetNodeRecord) {
  const token = row.auth_token || "";
  return {
    id: row.id,
    label: row.label,
    baseUrl: row.base_url,
    enabled: Boolean(row.enabled),
    local: false,
    status: "unknown",
    error: "",
    tokenConfigured: Boolean(token),
    redactedToken: token ? `${token.slice(0, 2)}...${token.slice(-2)}` : "",
    console: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function nodeRows() {
  return db.prepare("SELECT * FROM fleet_nodes ORDER BY label COLLATE NOCASE").all() as FleetNodeRecord[];
}

function nodeById(id: string) {
  return db.prepare("SELECT * FROM fleet_nodes WHERE id = ?").get(id) as FleetNodeRecord | undefined;
}

export function listFleetNodes() {
  return [localNode(), ...nodeRows().map(rowToNode)];
}

export function createFleetNode(input: any) {
  const payload = normalizeNodePayload(input);
  const now = nowIso();
  let id = slugifyNodeId(String(input?.id || payload.label));
  if (id === "local") id = `node-${crypto.randomUUID().slice(0, 8)}`;
  while (nodeById(id)) id = `${id.slice(0, 32)}-${crypto.randomUUID().slice(0, 6)}`;
  db.prepare(`
    INSERT INTO fleet_nodes (id, label, base_url, auth_token, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, payload.label, payload.baseUrl, payload.authToken, payload.enabled ? 1 : 0, now, now);
  return rowToNode(nodeById(id)!);
}

export function updateFleetNode(id: string, input: any) {
  if (id === "local") throw badRequest("The local node cannot be edited");
  const existing = nodeById(id);
  if (!existing) throw notFound("Fleet node not found");
  const payload = normalizeNodePayload(input, existing);
  db.prepare(`
    UPDATE fleet_nodes SET label = ?, base_url = ?, auth_token = ?, enabled = ?, updated_at = ?
    WHERE id = ?
  `).run(payload.label, payload.baseUrl, payload.authToken, payload.enabled ? 1 : 0, nowIso(), id);
  return rowToNode(nodeById(id)!);
}

export function deleteFleetNode(id: string) {
  if (id === "local") throw badRequest("The local node cannot be removed");
  db.prepare("DELETE FROM fleet_nodes WHERE id = ?").run(id);
  return { ok: true };
}

function notFound(message: string) {
  const error = new Error(message) as Error & { status?: number };
  error.status = 404;
  return error;
}

function upstreamUnavailable(status: number, message: string) {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}

async function remoteJson(node: FleetNodeRecord, path: string, options: RequestInit = {}, timeoutMs = 4500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${node.base_url}${path}`, {
      ...options,
      signal: controller.signal,
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        ...(node.auth_token ? { Authorization: `Bearer ${node.auth_token}` } : {}),
        ...(options.headers || {}),
      },
    });
    if (response.status >= 300 && response.status < 400) throw new Error(`Unexpected redirect to ${response.headers.get("location") || "unknown"}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function isRemoteRouteMissing(error: any) {
  return /HTTP 404|Cannot (GET|POST|DELETE|PUT|PATCH)/i.test(error?.message || "");
}

function remoteTelegramUnavailableError(node: FleetNodeRecord, action: string) {
  return upstreamUnavailable(
    409,
    `Telegram ${action} is not available on ${node.label}. Update and restart that Fleet Console node, then try again.`,
  );
}

export async function remoteFetch(node: FleetNodeRecord, path: string, options: RequestInit = {}, timeoutMs = 4500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${node.base_url}${path}`, {
      ...options,
      signal: controller.signal,
      redirect: "manual",
      headers: {
        ...(node.auth_token ? { Authorization: `Bearer ${node.auth_token}` } : {}),
        ...(options.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function annotateInstance(instance: any, node: any) {
  const displayName = fleetInstanceDisplayName(node.id, instance.name) || instance.displayName || "";
  return {
    ...normalizeRemoteInstanceEndpoints(instance, node),
    displayName,
    nodeId: node.id,
    nodeLabel: node.label,
    nodeLocal: Boolean(node.local),
    nodeStatus: node.status,
    fleetKey: `${node.id}:${instance.name}`,
  };
}

function annotateJob(job: any, node: any) {
  return {
    ...job,
    nodeId: node.id,
    nodeLabel: node.label,
    nodeLocal: Boolean(node.local),
    nodeStatus: node.status,
    fleetKey: `${node.id}:${job.instance || ""}:${job.id}`,
  };
}

export async function fleetOverview(options: { refreshVersions?: boolean } = {}) {
  const thisNode = { ...localNode(), checkedAt: new Date().toISOString() };
  const localInstances = (await listInstances(options)).map((instance) => annotateInstance(instance, thisNode));
  const localJobs = recentJobs(50).map((job) => annotateJob(job, thisNode));
  const nodes = [thisNode];
  const instances = [...localInstances];
  const jobs = [...localJobs];

  await Promise.all(nodeRows().filter((node) => Boolean(node.enabled)).map(async (row) => {
    const baseNode = rowToNode(row);
    try {
      const health = await remoteJson(row, "/api/health", {}, 3000);
      const [remoteInstances, remoteJobs] = await Promise.all([
        remoteJson(row, `/api/instances${options.refreshVersions ? "?refreshVersions=1" : ""}`, {}, 6000),
        remoteJson(row, "/api/jobs", {}, 6000),
      ]);
      const onlineNode = { ...baseNode, status: "online", error: "", console: health.console || null, checkedAt: new Date().toISOString() };
      nodes.push(onlineNode);
      instances.push(...(remoteInstances.instances || []).map((instance: any) => annotateInstance(instance, onlineNode)));
      jobs.push(...(remoteJobs.jobs || []).map((job: any) => annotateJob(job, onlineNode)));
    } catch (error: any) {
      nodes.push({ ...baseNode, status: "offline", error: error.message || "Unavailable", checkedAt: new Date().toISOString() });
    }
  }));

  if (options.refreshVersions) {
    await Promise.all(instances.map(async (instance) => {
      const currentRevision = String(instance.update?.currentRevision || "").trim();
      if (!currentRevision) return;
      instance.update = await updateInfoForRevision(currentRevision, { refresh: true });
    }));
  }

  return { nodes, instances, jobs };
}

export async function testFleetNode(id: string) {
  if (id === "local") return localNode();
  const row = nodeById(id);
  if (!row) throw notFound("Fleet node not found");
  try {
    const health = await remoteJson(row, "/api/health", {}, 3000);
    return { ...rowToNode(row), status: "online", error: "", console: health.console || null, health };
  } catch (error: any) {
    return { ...rowToNode(row), status: "offline", error: error.message || "Unavailable" };
  }
}

function proxyNode(id: string) {
  if (id === "local") return null;
  const row = nodeById(id);
  if (!row || !row.enabled) throw notFound("Fleet node not found");
  return row;
}

export function fleetProxyNode(id: string) {
  return proxyNode(id);
}

function annotateFleetJob(job: any, nodeId = "local") {
  if (!job) return job;
  const node = nodeId === "local" ? localNode() : rowToNode(nodeById(nodeId)!);
  return annotateJob(job, node);
}

function requireRiskConfirmation(action: string, payload: any = {}) {
  if (action === "start") return;
  if (payload?.confirmed || payload?.riskConfirmed || payload?.confirmedRisk || payload?.riskAccepted) return;
  const error = new Error("Risk confirmation required") as Error & { status?: number };
  error.status = 409;
  throw error;
}

export async function proxyCreateInstance(nodeId: string, payload: any, requestedBy = "local") {
  const name = validators.validateName(payload?.name || "");
  const runtime = validators.normalizeCreateRuntime(payload?.runtime || "docker");
  if (runtime === "nemoclaw") validators.validateNemoClawName(name);
  const dependencies = validators.normalizeCreateDependencies(payload?.dependencies || {});
  const capabilities = validators.normalizeCreateCapabilities(payload?.capabilities || {});
  if (runtime === "nemoclaw" && capabilities.codexCli) {
    throw badRequest("Codex CLI capability is only supported for Docker Hermes agents.");
  }
  if (runtime === "nemoclaw" && capabilities.sharedMemory) {
    throw badRequest("Shared memory capability is only supported for Docker Hermes agents.");
  }
  if (nodeId === "local" && capabilities.codexCli && !await codexCliAuthPayload()) {
    const error = new Error("Codex CLI capability requires a saved Codex device login in Fleet settings.") as Error & { status?: number };
    error.status = 409;
    throw error;
  }
  const contextFiles = validators.normalizeCreateContextFiles(payload?.contextFiles || {});
  const telegram = validators.normalizeCreateTelegramSetup(payload?.telegram || {});
  const body = {
    name,
    templateId: payload?.templateId || "blank",
    start: payload?.start !== false,
    runtime,
    dependencies,
    capabilities,
    contextFiles,
    telegram,
  };
  if (nodeId === "local") {
    return { job: annotateFleetJob(createJob("create", name, body, requestedBy), "local") };
  }
  const row = proxyNode(nodeId)!;
  const data = await remoteJson(row, "/api/instances", { method: "POST", body: JSON.stringify(body) }, 10000);
  return { job: annotateJob(data.job, { ...rowToNode(row), status: "online" }) };
}

export async function proxyStartTelegramOnboarding(nodeId: string, payload: any = {}) {
  if (nodeId === "local") return startTelegramOnboarding(payload);
  const row = proxyNode(nodeId)!;
  try {
    return await remoteJson(row, "/api/telegram/onboarding/start", { method: "POST", body: JSON.stringify(payload || {}) }, 12000);
  } catch (error: any) {
    if (isRemoteRouteMissing(error)) throw remoteTelegramUnavailableError(row, "QR setup");
    throw error;
  }
}

export async function proxyTelegramOnboardingStatus(nodeId: string, pairingId: string) {
  if (nodeId === "local") return telegramOnboardingStatus(pairingId);
  const row = proxyNode(nodeId)!;
  try {
    return await remoteJson(row, `/api/telegram/onboarding/${encodeURIComponent(pairingId)}`, {}, 12000);
  } catch (error: any) {
    if (isRemoteRouteMissing(error)) throw remoteTelegramUnavailableError(row, "QR setup status");
    throw error;
  }
}

export async function proxyCancelTelegramOnboarding(nodeId: string, pairingId: string) {
  if (nodeId === "local") return cancelTelegramOnboarding(pairingId);
  const row = proxyNode(nodeId)!;
  try {
    return await remoteJson(row, `/api/telegram/onboarding/${encodeURIComponent(pairingId)}`, { method: "DELETE" }, 12000);
  } catch (error: any) {
    if (isRemoteRouteMissing(error)) throw remoteTelegramUnavailableError(row, "QR setup cancellation");
    throw error;
  }
}

export async function proxyInstance(nodeId: string, name: string) {
  if (nodeId === "local") return { instance: annotateInstance(await instanceSnapshot(name), LOCAL_NODE) };
  const row = proxyNode(nodeId)!;
  const data = await remoteJson(row, `/api/instances/${encodeURIComponent(name)}`, {}, 7000);
  return { instance: annotateInstance(data.instance, { ...rowToNode(row), status: "online" }) };
}

export async function proxyInstanceDisplayName(nodeId: string, name: string, payload: any = {}) {
  const displayName = setFleetInstanceDisplayName(nodeId, name, payload?.displayName ?? "");
  if (nodeId === "local") {
    setInstanceDisplayName(name, displayName);
    return { instance: annotateInstance(await instanceSnapshot(name), LOCAL_NODE) };
  }
  const row = proxyNode(nodeId)!;
  try {
    const data = await remoteJson(row, `/api/instances/${encodeURIComponent(name)}`, {}, 7000);
    return { instance: annotateInstance(data.instance, { ...rowToNode(row), status: "online" }) };
  } catch {
    return { instance: annotateInstance({ name, displayName }, { ...rowToNode(row), status: "unknown" }) };
  }
}

export async function proxyInstanceAction(nodeId: string, name: string, action: string, payload: any = {}, requestedBy = "local") {
  requireRiskConfirmation(action, payload);
  const confirmed = Boolean(payload?.confirmed || payload?.riskConfirmed || payload?.confirmedRisk || payload?.riskAccepted);
  const actionPayload = confirmed ? { confirmed: true, riskConfirmed: true, confirmedRisk: true, riskAccepted: true } : {};
  if (nodeId === "local") return { job: createJob(action, name, actionPayload, requestedBy) };
  const row = proxyNode(nodeId)!;
  return remoteJson(row, `/api/instances/${encodeURIComponent(name)}/actions`, {
    method: "POST",
    headers: confirmed ? { "X-Risk-Confirmed": "true" } : {},
    body: JSON.stringify({ action, ...actionPayload }),
  }, 10000);
}

export async function proxyClone(nodeId: string, name: string, payload: any, requestedBy = "local") {
  if (nodeId === "local") return { job: createJob("clone", name, validators.normalizeCloneOptions(payload || {}), requestedBy) };
  const row = proxyNode(nodeId)!;
  return remoteJson(row, `/api/instances/${encodeURIComponent(name)}/clone`, { method: "POST", body: JSON.stringify(payload || {}) }, 10000);
}

export async function proxyMove(nodeId: string, name: string, payload: any, requestedBy = "local") {
  const sourceNodeId = validators.validateFleetNodeId(nodeId || "local");
  const options = validators.normalizeMoveOptions(payload || {});
  if (sourceNodeId === options.targetNodeId) throw badRequest("Choose a different target node");
  if (sourceNodeId !== "local") proxyNode(sourceNodeId);
  if (options.targetNodeId !== "local") proxyNode(options.targetNodeId);
  if (options.removeSource) requireRiskConfirmation("delete", payload);
  return {
    job: annotateFleetJob(createJob("fleet-move", name, {
      sourceNodeId,
      ...options,
    }, requestedBy), "local"),
  };
}

export async function proxyTelegramSetup(nodeId: string, name: string, payload: any, requestedBy = "local") {
  const telegram = validators.normalizeCreateTelegramSetup(payload?.telegram || payload || {});
  if (nodeId === "local") return { job: annotateFleetJob(createJob("telegram-setup", name, { telegram }, requestedBy), "local") };
  const row = proxyNode(nodeId)!;
  let data;
  try {
    data = await remoteJson(row, `/api/instances/${encodeURIComponent(name)}/telegram`, { method: "POST", body: JSON.stringify({ telegram }) }, 10000);
  } catch (error: any) {
    if (isRemoteRouteMissing(error)) throw remoteTelegramUnavailableError(row, "setup");
    throw error;
  }
  return { job: annotateJob(data.job, { ...rowToNode(row), status: "online" }) };
}

export async function proxyBackupExport(nodeId: string, payload: any, requestedBy = "local") {
  if (nodeId === "local") {
    const normalized = validators.normalizeBackupExport(payload || {});
    return { job: createJob("backup-export", normalized.names?.[0] || "", normalized, requestedBy) };
  }
  const row = proxyNode(nodeId)!;
  return remoteJson(row, "/api/backups/export", { method: "POST", body: JSON.stringify(payload || {}) }, 10000);
}

export async function proxyJobCancel(nodeId: string, jobId: number) {
  if (nodeId === "local") return { job: annotateFleetJob(cancelJob(jobId), "local") };
  const row = proxyNode(nodeId)!;
  const data = await remoteJson(row, `/api/jobs/${encodeURIComponent(String(jobId))}/cancel`, { method: "POST", body: JSON.stringify({}) }, 10000);
  return { job: annotateJob(data.job, { ...rowToNode(row), status: "online" }) };
}

export async function proxyJobStatus(nodeId: string, jobId: number) {
  if (nodeId === "local") return { job: annotateFleetJob(getJob(jobId), "local") };
  const row = proxyNode(nodeId)!;
  const data = await remoteJson(row, `/api/jobs/${encodeURIComponent(String(jobId))}`, {}, 10000);
  return { job: annotateJob(data.job, { ...rowToNode(row), status: "online" }) };
}

export async function proxyGateway(nodeId: string, name: string) {
  if (nodeId === "local") return gatewayResponseForInstance(name);
  const row = proxyNode(nodeId)!;
  const [gatewayResult, instanceResult] = await Promise.allSettled([
    remoteJson(row, `/api/instances/${encodeURIComponent(name)}/gateway`, {}, 7000),
    remoteJson(row, `/api/instances/${encodeURIComponent(name)}`, {}, 7000),
  ]);
  if (gatewayResult.status === "rejected") throw gatewayResult.reason;
  const data = gatewayResult.value || {};
  const remoteInstance = instanceResult.status === "fulfilled" ? instanceResult.value?.instance : null;
  const endpoints = normalizeRemoteGatewayEndpoints(data, row);
  const dashboardAuth = data.dashboardAuth || {
    username: "fleet",
    password: "",
    available: false,
    reason: "remote_console_needs_update",
    source: "remote_gateway",
  };
  const diagnostics = await diagnoseGatewayEndpoints(endpoints, {
    nodeId,
    nodeBaseUrl: row.base_url,
    nodeLocal: false,
    nodeReportedHealth: remoteInstance?.health,
    remoteUpdate: remoteInstance?.update,
    remoteDiagnostics: data.diagnostics,
    runtime: data.diagnostics?.runtime,
    terminalReachable: true,
  });
  return { ...data, ...endpoints, dashboardAuth, dashboardUnavailable: diagnostics.dashboard.reachable === false, diagnostics };
}

export async function proxySessions(nodeId: string, name: string, limit: number, offset: number) {
  if (nodeId === "local") return listSessions(name, limit, offset);
  const row = proxyNode(nodeId)!;
  try {
    return await remoteJson(row, `/api/instances/${encodeURIComponent(name)}/sessions?limit=${encodeURIComponent(String(limit))}&offset=${encodeURIComponent(String(offset))}`, {}, 7000);
  } catch (error: any) {
    if (isRemoteDashboardAuthError(error)) return { sessions: [], total: 0, limit, offset, dashboardUnavailable: true };
    throw error;
  }
}

export async function proxySessionMessages(nodeId: string, name: string, sessionId: string) {
  if (nodeId === "local") return sessionMessages(name, sessionId);
  const row = proxyNode(nodeId)!;
  try {
    return await remoteJson(row, `/api/instances/${encodeURIComponent(name)}/sessions/${encodeURIComponent(sessionId)}/messages`, {}, 7000);
  } catch (error: any) {
    if (isRemoteDashboardAuthError(error)) return { sessionId, messages: [], dashboardUnavailable: true };
    throw error;
  }
}

export async function proxySessionChat(nodeId: string, name: string, payload: any, requestedBy = "local") {
  if (nodeId === "local") {
    const turn = await prepareChatTurn(name, payload || {});
    if (turn.mode === "job") return { ...turn, job: annotateFleetJob(createJob("session-chat", name, turn.jobPayload, requestedBy), "local") };
    return turn;
  }
  const row = proxyNode(nodeId)!;
  const data = await remoteJson(row, `/api/instances/${encodeURIComponent(name)}/sessions/chat`, { method: "POST", body: JSON.stringify(payload || {}) }, 15000);
  return data.job ? { mode: data.mode || "job", status: data.status || "queued", ...data, job: annotateJob(data.job, { ...rowToNode(row), status: "online" }) } : data;
}

export async function proxyChatRunStatus(nodeId: string, name: string, runId: string) {
  if (nodeId === "local") return chatRunStatus(name, runId);
  const row = proxyNode(nodeId)!;
  return remoteJson(row, `/api/instances/${encodeURIComponent(name)}/sessions/runs/${encodeURIComponent(runId)}`, {}, 10000);
}

export async function proxyStopChatRun(nodeId: string, name: string, runId: string) {
  if (nodeId === "local") return stopChatRun(name, runId);
  const row = proxyNode(nodeId)!;
  return remoteJson(row, `/api/instances/${encodeURIComponent(name)}/sessions/runs/${encodeURIComponent(runId)}/stop`, { method: "POST", body: JSON.stringify({}) }, 10000);
}

export async function proxyTerminalTicket(nodeId: string, name: string) {
  if (nodeId === "local") {
    const ticket = createTerminalTicket(name);
    return { ticket, wsUrl: `/api/instances/${encodeURIComponent(name)}/terminal?ticket=${encodeURIComponent(ticket)}` };
  }
  const ticket = createTerminalTicket(`${nodeId}:${name}`);
  return { ticket, wsUrl: `/api/fleet/${encodeURIComponent(nodeId)}/instances/${encodeURIComponent(name)}/terminal?ticket=${encodeURIComponent(ticket)}` };
}

export async function proxyCrons(nodeId: string, name: string) {
  if (nodeId === "local") return readCronEntries(name);
  const row = proxyNode(nodeId)!;
  try {
    return await remoteJson(row, `/api/instances/${encodeURIComponent(name)}/crons`, {}, 7000);
  } catch (error: any) {
    if (/Unexpected redirect|HTTP 404|Cannot GET/i.test(error.message || "")) {
      return {
        root: "",
        entries: [],
        truncated: false,
        unavailable: true,
        message: "CRON viewing is not available on this remote fleet node until that node is updated.",
      };
    }
    throw error;
  }
}

export async function proxyCredentials(nodeId: string, name: string) {
  if (nodeId === "local") return credentialSummaries(name);
  const row = proxyNode(nodeId)!;
  return remoteJson(row, `/api/instances/${encodeURIComponent(name)}/credentials`, {}, 7000);
}

export async function proxyPaymentPolicy(nodeId: string, name: string) {
  if (nodeId === "local") return { policy: await readPaymentPolicy(name) };
  const row = proxyNode(nodeId)!;
  return remoteJson(row, `/api/instances/${encodeURIComponent(name)}/payment-policy`, {}, 7000);
}

export async function proxyBackups(nodeId: string) {
  if (nodeId === "local") return { backups: await listBackups() };
  const row = proxyNode(nodeId)!;
  return remoteJson(row, "/api/backups", {}, 7000);
}

export async function proxyBackupDownload(nodeId: string, file: string) {
  if (nodeId === "local") return { localPath: safeArchivePath(file), file };
  const row = proxyNode(nodeId)!;
  return remoteFetch(row, `/api/backups/${encodeURIComponent(file)}/download`, {}, 30000);
}

export async function proxyBackupInspect(nodeId: string, payload: any) {
  if (nodeId === "local") return inspectBackup(String(payload?.archivePath || ""));
  const row = proxyNode(nodeId)!;
  return remoteJson(row, "/api/backups/inspect", { method: "POST", body: JSON.stringify(payload || {}) }, 30000);
}

function normalizeSyncTargets(targets: any[] = []) {
  return (Array.isArray(targets) ? targets : []).map((target) => ({
    nodeId: String(target?.nodeId || "local").trim() || "local",
    name: validators.validateName(target?.name || ""),
  })).filter((target) => target.name);
}

export async function syncGlobalConfigAcrossFleetTargets(targets: any[] = [], requestedBy = "local") {
  const bundle = await exportGlobalConfigBundle();
  const normalizedTargets = normalizeSyncTargets(targets);
  const targetMode = normalizedTargets.length > 0;
  const namesByNode = new Map<string, string[]>();
  for (const target of normalizedTargets) {
    const names = namesByNode.get(target.nodeId) || [];
    if (!names.includes(target.name)) namesByNode.set(target.nodeId, [...names, target.name]);
  }
  const remoteRows = nodeRows().filter((node) => Boolean(node.enabled) && (!targetMode || namesByNode.has(node.id)));
  const nodes = [{ id: "local", label: LOCAL_NODE.label, local: true }, ...remoteRows.map(rowToNode)];
  const results = [];
  if (!targetMode || namesByNode.has("local")) {
    const localNames = namesByNode.get("local") || [];
    const localJob = createJob("global-config-sync", "", targetMode ? { names: localNames, scoped: true } : {}, requestedBy);
    results.push({ nodeId: "local", nodeLabel: LOCAL_NODE.label, status: "queued", job: annotateFleetJob(localJob, "local") });
  }
  await Promise.all(remoteRows.map(async (row) => {
    const node = rowToNode(row);
    try {
      const names = namesByNode.get(node.id) || [];
      await remoteJson(row, "/api/global-config/import", { method: "POST", body: JSON.stringify(bundle) }, 15000);
      const syncBody = targetMode ? { names } : {};
      const data = await remoteJson(row, "/api/global-config/sync", { method: "POST", body: JSON.stringify(syncBody) }, 10000);
      const remoteJob = data.job || data.results?.find((item: any) => item.job)?.job;
      results.push({ nodeId: node.id, nodeLabel: node.label, status: "queued", job: annotateJob(remoteJob, { ...node, status: "online" }) });
    } catch (error: any) {
      results.push({ nodeId: node.id, nodeLabel: node.label, status: "failed", error: error.message || "Sync failed" });
    }
  }));
  return { nodes, results, config: await globalConfig() };
}

export async function proxyConsoleGitUpdateRestart(nodeId: string) {
  if (nodeId === "local") return startConsoleGitUpdateRestart();
  const row = proxyNode(nodeId)!;
  return remoteJson(row, "/api/system/git-update-restart", { method: "POST", body: JSON.stringify({ force: true }) }, 10000);
}

export async function proxyConsoleGitUpdateStatus(nodeId: string) {
  if (nodeId === "local") return consoleGitUpdateStatus();
  const row = proxyNode(nodeId)!;
  return remoteJson(row, "/api/system/git-update-restart/status", {}, 10000);
}
