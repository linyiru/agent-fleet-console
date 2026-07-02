import fsSync from "node:fs";
import { BUILD_TIMEOUT_MS, validators } from "../config.ts";
import { db } from "../database.ts";
import { missingFromConfig, type TemplateRequirements } from "./template-library-requirements.ts";

type DeployOptions = {
  id: string;
  name: string;
  targetNodeId?: string;
  start?: boolean;
  allowMissingRequirements?: boolean;
};

type FleetNodeRecord = {
  id: string;
  label: string;
  base_url: string;
  auth_token: string;
  enabled: number;
};

function httpError(message: string, status = 400) {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}

function nodeById(id: string) {
  return db.prepare("SELECT * FROM fleet_nodes WHERE id = ?").get(id) as FleetNodeRecord | undefined;
}

function requireRemoteNode(id: string) {
  const row = nodeById(id);
  if (!row || !row.enabled) throw httpError("Fleet node not found", 404);
  return row;
}

function authHeaders(node: FleetNodeRecord) {
  return node.auth_token ? { Authorization: `Bearer ${node.auth_token}` } : {};
}

async function remoteJson(node: FleetNodeRecord, route: string, options: RequestInit = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${node.base_url}${route}`, {
      ...options,
      signal: controller.signal,
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(node),
        ...(options.headers || {}),
      },
    });
    if (response.status >= 300 && response.status < 400) throw new Error(`Unexpected redirect to ${response.headers.get("location") || "unknown"}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `HTTP ${response.status}`) as Error & { status?: number; details?: any };
      error.status = response.status;
      error.details = data;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function remoteFetch(node: FleetNodeRecord, route: string, options: RequestInit = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${node.base_url}${route}`, {
      ...options,
      signal: controller.signal,
      redirect: "manual",
      headers: {
        ...authHeaders(node),
        ...(options.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function remoteArchiveImport(node: FleetNodeRecord, archivePath: string, file: string) {
  const stream = fsSync.createReadStream(archivePath);
  const uploadOptions = {
    method: "POST",
    headers: {
      "Content-Type": "application/gzip",
      "X-Hermes-Archive-File": file,
    },
    body: stream,
    duplex: "half",
  } as unknown as RequestInit & { duplex: "half" };
  const response = await remoteFetch(node, "/api/backups/import", uploadOptions, BUILD_TIMEOUT_MS);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw httpError(data.error || `HTTP ${response.status}`, response.status);
  return data;
}

function annotateRemoteJob(job: any, node: FleetNodeRecord) {
  return {
    ...job,
    nodeId: node.id,
    nodeLabel: node.label,
    nodeLocal: false,
    nodeStatus: "online",
    fleetKey: `${node.id}:${job?.instance || ""}:${job?.id || ""}`,
  };
}

export async function checkRemoteTemplateRequirements(targetNodeId: string, requirements: TemplateRequirements = {}) {
  const node = requireRemoteNode(validators.validateFleetNodeId(targetNodeId));
  const config = await remoteJson(node, "/api/global-config", {}, 10000);
  return missingFromConfig(requirements, config);
}

export async function deployTemplateToRemote(template: any, options: DeployOptions) {
  const node = requireRemoteNode(validators.validateFleetNodeId(options.targetNodeId || ""));
  const targetName = validators.validateName(options.name);
  const check = await checkRemoteTemplateRequirements(node.id, template.requirements);
  if (!check.ok && !options.allowMissingRequirements) {
    const error = httpError("Template requirements are missing on the target node", 409) as Error & { details?: any };
    error.details = check;
    throw error;
  }
  const imported = await remoteArchiveImport(node, template.archive.path, template.archive.file);
  const archivePath = imported.archive?.path;
  if (!archivePath) throw httpError("Target node did not return an imported archive path", 502);
  const data = await remoteJson(node, "/api/template-library/archive/deploy", {
    method: "POST",
    body: JSON.stringify({
      archivePath,
      name: targetName,
      start: options.start !== false,
      allowMissingRequirements: options.allowMissingRequirements === true,
    }),
  }, 15000);
  return { ...data, job: annotateRemoteJob(data.job, node), requirements: check };
}
