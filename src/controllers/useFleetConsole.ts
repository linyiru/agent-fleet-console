import { useEffect, useMemo, useRef, useState } from "react";
import { api, postJson, putJson } from "./api.ts";
import { activeJob, isAgentReady } from "./format.ts";
import type { AgentBackupOptions, AgentCloneOptions, AgentMoveOptions, AgentSyncTarget, AgentTemplateCaptureOptions, BaselineStatus, CreateAgentOptions, FleetNode, GlobalConfig, Instance, Job, ProviderCatalog, ProviderConfig, TelegramAgentOptions } from "../models/fleet.ts";
import { EMPTY_GLOBAL_CONFIG } from "../models/fleet.ts";

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

const MIN_INITIAL_LOAD_MS = 650;

function fleetKey(name: string, nodeId = "local") {
  return `${nodeId || "local"}:${name}`;
}

function initialView() {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return (params.get("view") || params.get("page") || "").trim().toLowerCase();
}

function hasSetupPreview() {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return Boolean(params.get("setupPreview") || params.get("setupState"));
}

function pendingInstance(name: string, job: Job | null, options: CreateAgentOptions, node?: FleetNode): Instance {
  const camofox = options.runtime === "nemoclaw" ? false : options.camofox;
  const nodeId = node?.id || options.nodeId || "local";
  return {
    name,
    displayName: "",
    nodeId,
    nodeLabel: node?.label || job?.nodeLabel || (nodeId === "local" ? "Local Docker" : nodeId),
    nodeLocal: nodeId === "local",
    nodeStatus: node?.status || job?.nodeStatus || "online",
    fleetKey: fleetKey(name, nodeId),
    state: "preparing",
    pendingCreate: true,
    pendingJobId: job?.id || null,
    pendingJobStatus: job?.status || "queued",
    pendingJobProgress: Number(job?.progress || 0),
    services: [],
    serviceCount: camofox ? 2 : 1,
    runningServices: 0,
    health: { dashboard: false, camofox: false },
    memory: { ok: false, provider: "", pluginOk: false, fileCount: 0, totalBytes: 0 },
    capabilities: {
      codexCli: {
        ready: false,
        provider: options.capabilities?.codexCli ? "openai-codex" : "",
        client: options.capabilities?.codexCli ? "codex" : "",
      },
      sharedMemory: {
        ready: false,
        provider: options.capabilities?.sharedMemory ? "fleet-shared-memory" : "",
      },
    },
    endpoints: {},
    ports: {},
    dependencies: { camofox },
    runtime: options.runtime,
    network: {},
    config: {},
    update: { status: "unknown", versionsBehind: null },
    drift: { status: "unknown" },
    timeline: [],
  };
}

export function useFleetConsole() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [fleetNodes, setFleetNodes] = useState<FleetNode[]>([]);
  const [globalConfig, setGlobalConfig] = useState<GlobalConfig>(EMPTY_GLOBAL_CONFIG);
  const [providerCatalog, setProviderCatalog] = useState<ProviderCatalog>({ providers: [] });
  const [selectedName, setSelectedName] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(() => initialView() === "settings");
  const [detailOpen, setDetailOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(() => ["setup", "onboarding"].includes(initialView()) || hasSetupPreview());
  const [baseline, setBaseline] = useState<BaselineStatus | null>(null);
  const [baselineLoading, setBaselineLoading] = useState(true);
  const [pendingActions, setPendingActions] = useState<Record<string, string>>({});
  const dashboardVersionCheckDone = useRef(false);

  const activeJobs = useMemo(() => jobs.filter(activeJob), [jobs]);
  const selected = useMemo(() => instances.find((item) => (item.fleetKey || fleetKey(item.name, item.nodeId)) === selectedName || (item.nodeLocal !== false && item.name === selectedName)) || null, [instances, selectedName]);

  async function loadFleet(quiet = false, refreshVersions = false) {
    const startedAt = Date.now();
    if (!quiet) setLoading(true);
    setRefreshing(true);
    try {
      const overviewPath = `/api/fleet/overview${refreshVersions ? "?refreshVersions=1" : ""}`;
      const [fleet, nodeConfig] = await Promise.all([
        api<{ nodes: FleetNode[]; instances: Instance[]; jobs: Job[] }>(overviewPath),
        api<{ nodes: FleetNode[] }>("/api/fleet/nodes"),
      ]);
      const control = { jobs: fleet.jobs || [] };
      const statusById = new Map((fleet.nodes || []).map((node) => [node.id, node]));
      setFleetNodes((nodeConfig.nodes || []).map((node) => ({ ...node, ...(statusById.get(node.id) || {}) })));
      setJobs(control.jobs || []);
      setInstances((current) => mergePending(fleet.instances || [], current, control.jobs || []));
      setError("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      if (!quiet) await delay(Math.max(0, MIN_INITIAL_LOAD_MS - (Date.now() - startedAt)));
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function loadGlobalConfig() {
    const [config, catalog] = await Promise.all([
      api<GlobalConfig>("/api/global-config"),
      api<ProviderCatalog>("/api/hermes-provider-catalog"),
    ]);
    setGlobalConfig(config);
    setProviderCatalog(catalog);
  }

  async function loadBaseline() {
    setBaselineLoading(true);
    try {
      setBaseline(await api<BaselineStatus>("/api/setup/baseline"));
    } finally {
      setBaselineLoading(false);
    }
  }

  function openAgent(name: string, nodeId = "local") {
    setSelectedName(fleetKey(name, nodeId));
  }

  function openAdvanced(name?: string, nodeId = "local") {
    const targetName = name ? fleetKey(name, nodeId) : selectedName;
    const target = instances.find((item) => (item.fleetKey || fleetKey(item.name, item.nodeId)) === targetName);
    if (name) setSelectedName(targetName);
    if (!isAgentReady(target, jobs)) {
      setDetailOpen(false);
      return;
    }
    setDetailOpen(true);
  }

  async function createAgent(name: string, options: CreateAgentOptions) {
    const runtime = options.runtime || "docker";
    const camofox = runtime === "nemoclaw" ? false : options.camofox;
    const nodeId = options.nodeId || "local";
    const node = fleetNodes.find((item) => item.id === nodeId);
    const result = options.templateLibraryId
      ? await postJson<{ job: Job }>(`/api/template-library/${encodeURIComponent(options.templateLibraryId)}/deploy`, {
        name,
        targetNodeId: nodeId,
        start: true,
      })
      : await postJson<{ job: Job }>(`/api/fleet/${encodeURIComponent(nodeId)}/instances`, {
        name,
        templateId: "personal-assistant",
        start: true,
        runtime,
        dependencies: { camofox },
        capabilities: options.capabilities || {},
        contextFiles: options.contextFiles || {},
        telegram: options.telegram || { enabled: false },
      });
    const placeholder = pendingInstance(name, result.job, { ...options, runtime, camofox, nodeId }, node);
    const key = fleetKey(name, nodeId);
    setInstances((current) => [...current.filter((item) => (item.fleetKey || fleetKey(item.name, item.nodeId)) !== key), placeholder].sort((a, b) => a.name.localeCompare(b.name)));
    setSelectedName(key);
    setDetailOpen(false);
    setCreateOpen(false);
    await loadFleet(true);
  }

  async function runAgentAction(name: string, action: string, nodeId = "local", confirmed = action === "start") {
    const key = fleetKey(name, nodeId);
    if (!name || pendingActions[key]) return;
    setPendingActions((current) => ({ ...current, [key]: action }));
    try {
      setSelectedName(key);
      await postJson(`/api/fleet/${encodeURIComponent(nodeId)}/instances/${encodeURIComponent(name)}/actions`, {
        action,
        confirmed,
        riskConfirmed: confirmed,
      });
      await loadFleet(true);
    } finally {
      setPendingActions((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }

  async function runAction(action: string) {
    if (!selected) return;
    await runAgentAction(selected.name, action, selected.nodeId || "local", action !== "start");
  }

  async function cancelJob(job: Job) {
    await postJson(`/api/fleet/${encodeURIComponent(job.nodeId || "local")}/jobs/${encodeURIComponent(String(job.id))}/cancel`, {});
    await loadFleet(true);
  }

  async function saveGlobalProvider(provider: ProviderConfig) {
    await putJson("/api/global-config/provider", provider);
    await loadGlobalConfig();
  }

  async function saveGlobalCredential(key: string, value: string) {
    await putJson("/api/global-config/credentials", { key, value });
    await loadGlobalConfig();
  }

  async function syncGlobalConfig(targets: AgentSyncTarget[] = []) {
    const result = await postJson<{ job?: Job; results?: Array<{ job?: Job; status: string; error?: string }> }>("/api/fleet/global-config/sync", targets.length ? { targets } : {});
    const deadline = Date.now() + 180000;
    const queuedJobs = [
      ...(result.job ? [result.job] : []),
      ...(result.results || []).map((item) => item.job).filter(Boolean) as Job[],
    ];
    const finalJobs = new Map(queuedJobs.map((job) => [`${job.nodeId || "local"}:${job.id}`, job]));
    while (queuedJobs.length && Date.now() < deadline) {
      const control = await api<{ nodes: FleetNode[]; instances: Instance[]; jobs: Job[] }>("/api/fleet/overview");
      for (const queued of queuedJobs) {
        const key = `${queued.nodeId || "local"}:${queued.id}`;
        const latest = control.jobs.find((candidate) => candidate.id === queued.id && (candidate.nodeId || "local") === (queued.nodeId || "local"));
        if (latest) finalJobs.set(key, latest);
      }
      const stillActive = queuedJobs.some((queued) => {
        const latest = finalJobs.get(`${queued.nodeId || "local"}:${queued.id}`) || queued;
        return activeJob(latest);
      });
      if (!stillActive) break;
      await delay(500);
    }
    await loadFleet(true);
    await loadGlobalConfig();
    const failedNode = result.results?.find((item) => item.status === "failed");
    if (failedNode) throw new Error(failedNode.error || "One or more remote syncs failed.");
    const failedJob = [...finalJobs.values()].find((job) => job.status === "failed");
    if (failedJob) throw new Error(failedJob.error || `${failedJob.nodeLabel || "A node"} agent sync failed.`);
  }

  async function backupAgent(name: string, options: AgentBackupOptions, nodeId = "local") {
    await postJson(`/api/fleet/${encodeURIComponent(nodeId)}/backups/export`, { scope: "agent", names: [name], ...options });
    await loadFleet(true);
  }

  async function captureAgentTemplate(name: string, options: AgentTemplateCaptureOptions, nodeId = "local") {
    await postJson("/api/template-library/capture", {
      sourceName: name,
      sourceNodeId: nodeId,
      name: options.name,
      description: options.description,
      includeWorkspace: options.includeWorkspace,
    });
  }

  async function cloneAgent(name: string, options: AgentCloneOptions, nodeId = "local") {
    await postJson(`/api/fleet/${encodeURIComponent(nodeId)}/instances/${encodeURIComponent(name)}/clone`, options);
    await loadFleet(true);
  }

  async function moveAgent(name: string, options: AgentMoveOptions, nodeId = "local") {
    await postJson(`/api/fleet/${encodeURIComponent(nodeId)}/instances/${encodeURIComponent(name)}/move`, {
      ...options,
      confirmed: options.removeSource,
      riskConfirmed: options.removeSource,
    });
    await loadFleet(true);
  }

  async function connectTelegram(name: string, telegram: TelegramAgentOptions, nodeId = "local") {
    await postJson(`/api/fleet/${encodeURIComponent(nodeId)}/instances/${encodeURIComponent(name)}/telegram`, { telegram });
    await loadFleet(true);
  }

  async function renameAgent(name: string, displayName: string, nodeId = "local") {
    await putJson(`/api/fleet/${encodeURIComponent(nodeId)}/instances/${encodeURIComponent(name)}/display-name`, { displayName });
    await loadFleet(true);
  }

  useEffect(() => {
    const refreshVersions = !dashboardVersionCheckDone.current;
    dashboardVersionCheckDone.current = true;
    loadFleet(false, refreshVersions);
    loadGlobalConfig().catch((err) => setError(err.message));
    loadBaseline().catch((err) => setError(err.message));
    const timer = window.setInterval(() => loadFleet(true), activeJobs.length ? 2500 : 10000);
    return () => window.clearInterval(timer);
  }, [activeJobs.length]);

  return {
    activeJobs, backupAgent, baseline, baselineLoading, cancelJob, captureAgentTemplate, cloneAgent, connectTelegram, createAgent, createOpen, detailOpen, error, fleetNodes, globalConfig, instances, jobs, loadBaseline, loadFleet, moveAgent,
    loading, onboardingOpen, openAdvanced, openAgent, pendingAction: selectedName ? pendingActions[selectedName] || "" : "", pendingActions, providerCatalog, refreshing, runAction, runAgentAction, saveGlobalCredential, saveGlobalProvider,
    refreshGlobalConfig: loadGlobalConfig, renameAgent, selected, setCreateOpen, setDetailOpen, setOnboardingOpen, setSettingsOpen, settingsOpen, syncGlobalConfig,
  };
}

function mergePending(fresh: Instance[], current: Instance[], jobs: Job[]) {
  const byName = new Map(fresh.map((item) => [item.fleetKey || fleetKey(item.name, item.nodeId), item]));
  for (const item of current.filter((instance) => instance.pendingCreate)) {
    const key = item.fleetKey || fleetKey(item.name, item.nodeId);
    if (byName.has(key)) continue;
    const job = jobs.find((candidate) => candidate.id === item.pendingJobId)
      || jobs.find((candidate) => candidate.instance === item.name && candidate.action === "create");
    byName.set(key, {
      ...item,
      pendingJobId: job?.id || item.pendingJobId,
      pendingJobStatus: job?.status || item.pendingJobStatus,
      pendingJobProgress: Number(job?.progress ?? item.pendingJobProgress ?? 0),
    });
  }
  return [...byName.values()].sort((a, b) => `${a.nodeLabel || ""}:${a.displayName || a.name}`.localeCompare(`${b.nodeLabel || ""}:${b.displayName || b.name}`));
}
