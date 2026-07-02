import { ArrowDown, ArrowUp, Minus, Archive, BriefcaseBusiness, ChevronDown, ChevronRight, ChevronUp, CircleStop, Clock, CopyPlus, Download, Edit3, EllipsisVertical, ExternalLink, Globe2, HardDrive, Library, MemoryStick, MoveRight, Network, Play, Plus, RotateCw, Search, Trash2, Wrench } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import type { AgentBackupOptions, AgentCloneOptions, AgentMoveOptions, AgentSyncTarget, AgentTemplateCaptureOptions, BaselineStatus, FleetNode, GlobalConfig, Instance, Job, ProviderCatalog, ProviderConfig } from "../models/fleet.ts";
import { classNames, isAgentReady, stateLabel, stateTone } from "../controllers/format.ts";
import { FLEET_METRIC_HISTORY_KEY, appendFleetMetricSnapshot, buildFleetMetricSnapshot, fleetMetricSeries, sanitizeFleetMetricHistory, sparklineGeometry, trendDelta, type FleetMetricSnapshot } from "../controllers/fleet-metrics.ts";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog.tsx";
import { Button } from "../components/ui/button.tsx";
import { Checkbox } from "../components/ui/checkbox.tsx";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from "../components/ui/context-menu.tsx";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "../components/ui/dropdown-menu.tsx";
import { Input } from "../components/ui/input.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table.tsx";
import { AgentBackupModal } from "./AgentBackupModal.tsx";
import { AgentCloneModal } from "./AgentCloneModal.tsx";
import { AgentMoveModal } from "./AgentMoveModal.tsx";
import { AgentRenameModal } from "./AgentRenameModal.tsx";
import { AgentTemplateCaptureModal } from "./AgentTemplateCaptureModal.tsx";
import { OnboardingScreen } from "./OnboardingScreen.tsx";
import { SettingsScreen } from "./SettingsModal.tsx";
import { DashboardPageFrame, DashboardPageStack } from "../components/layout/FleetShell.tsx";

type Props = {
  activeJobs: Job[];
  baseline: BaselineStatus | null;
  baselineLoading: boolean;
  instances: Instance[];
  fleetNodes?: FleetNode[];
  loadBaseline: () => Promise<void>;
  onboardingOpen: boolean;
  openAdvanced: (name?: string, nodeId?: string) => void;
  backupAgent: (name: string, options: AgentBackupOptions, nodeId?: string) => Promise<void>;
  captureAgentTemplate: (name: string, options: AgentTemplateCaptureOptions, nodeId?: string) => Promise<void>;
  cloneAgent: (name: string, options: AgentCloneOptions, nodeId?: string) => Promise<void>;
  moveAgent: (name: string, options: AgentMoveOptions, nodeId?: string) => Promise<void>;
  pendingActions: Record<string, string>;
  renameAgent: (name: string, displayName: string, nodeId?: string) => Promise<void>;
  runAgentAction: (name: string, action: string, nodeId?: string) => Promise<void>;
  selected: Instance | null;
  setCreateOpen: (open: boolean) => void;
  setOnboardingOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  settingsOpen: boolean;
  globalConfig: GlobalConfig;
  providerCatalog: ProviderCatalog;
  onRefreshGlobalConfig: () => Promise<void>;
  onSaveProvider: (provider: ProviderConfig) => Promise<void>;
  onSaveCredential: (key: string, value: string) => Promise<void>;
  onSync: (targets?: AgentSyncTarget[]) => Promise<void>;
  loadFleet: (quiet?: boolean, refreshVersions?: boolean) => Promise<void>;
};

function unit(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function ratio(current: number, total: number) {
  return `${current}/${total}`;
}

function fleetKey(name: string, nodeId?: string) {
  return `${nodeId || "local"}:${name}`;
}

function shouldShowDemoPage() {
  if (typeof window === "undefined") return false;
  const value = new URLSearchParams(window.location.search).get("demo");
  return value === "" || value === "1" || value === "true";
}

const DEMO_ACTIVE_JOBS: Job[] = [];

export function FleetDashboard(props: Props) {
  const [emptyDashboardOpen, setEmptyDashboardOpen] = useState(false);
  const demoPage = shouldShowDemoPage();
  const instances = demoPage ? BUSINESS_AGENT_PLACEHOLDERS : props.instances;
  const activeJobs = demoPage ? DEMO_ACTIVE_JOBS : props.activeJobs;
  const snapshot = useMemo(() => buildFleetMetricSnapshot(instances, activeJobs), [instances, activeJobs]);
  const [metricHistory, setMetricHistory] = useState(readStoredMetricHistory);
  const hasAgents = instances.length > 0;
  const runningAgents = snapshot.runningAgents;
  const serviceCount = snapshot.services;
  const runningServices = snapshot.runningServices;
  const activeJobCount = snapshot.activeJobs;
  const degraded = runningAgents < instances.length || Boolean(serviceCount && runningServices < serviceCount);
  const nodeCount = demoPage ? new Set(instances.map((instance) => instance.nodeId)).size : props.fleetNodes?.length || 1;
  const runningAgentSeries = fleetMetricSeries(metricHistory, "runningAgents", snapshot);
  const serviceHealthSeries = fleetMetricSeries(metricHistory, "serviceHealth", snapshot);
  const activeJobSeries = fleetMetricSeries(metricHistory, "activeJobs", snapshot);
  const dataHealthSeries = fleetMetricSeries(metricHistory, "dataHealth", snapshot);

  const showOnboarding = !demoPage && (props.onboardingOpen || (!hasAgents && !emptyDashboardOpen));

  useEffect(() => {
    setMetricHistory((current) => {
      const next = appendFleetMetricSnapshot(current, snapshot);
      if (next === current) return current;
      writeStoredMetricHistory(next);
      return next;
    });
  }, [snapshot.checkedAt, snapshot.agents, snapshot.runningAgents, snapshot.services, snapshot.runningServices, snapshot.serviceHealth, snapshot.activeJobs, snapshot.dataHealth]);

  const pageFrameHandlers = useMemo(() => {
    const setDashboardMode = () => {
      setEmptyDashboardOpen(true);
      props.setOnboardingOpen(false);
      props.setSettingsOpen(false);
    };
    const setSetupMode = () => {
      setEmptyDashboardOpen(false);
      props.setOnboardingOpen(true);
      props.setSettingsOpen(false);
    };
    const setSettingsMode = () => props.setSettingsOpen(true);

    const fromDashboard = {
      onDashboard: () => undefined,
      onSetup: setSetupMode,
      onSettings: setSettingsMode,
      onNewAgent: () => props.setCreateOpen(true),
    };
    const fromSetup = {
      onDashboard: () => {
        setEmptyDashboardOpen(!hasAgents);
        props.setOnboardingOpen(false);
      },
      onSetup: () => undefined,
      onSettings: setSettingsMode,
      onNewAgent: () => props.setCreateOpen(true),
    };
    const fromSettings = {
      onDashboard: setDashboardMode,
      onSetup: setSetupMode,
      onSettings: () => undefined,
      onNewAgent: () => props.setCreateOpen(true),
    };

    return {
      dashboard: fromDashboard,
      setup: fromSetup,
      settings: fromSettings,
    } as const;
  }, [
    hasAgents,
    props.setCreateOpen,
    props.setOnboardingOpen,
    props.setSettingsOpen,
  ]);

  if (props.settingsOpen) {
    return (
      <DashboardPageFrame
        activePage="settings"
        setupReady={Boolean(props.baseline?.ok)}
        {...pageFrameHandlers.settings}
      >
        <SettingsScreen
          fleetNodes={props.fleetNodes || []}
          globalConfig={props.globalConfig}
          instances={props.instances}
          onRefreshFleet={() => props.loadFleet(true)}
          onRefreshGlobalConfig={props.onRefreshGlobalConfig}
          onSaveCredential={props.onSaveCredential}
          onSaveProvider={props.onSaveProvider}
          onSync={props.onSync}
          providerCatalog={props.providerCatalog}
        />
      </DashboardPageFrame>
    );
  }

  if (showOnboarding) {
    return (
      <DashboardPageFrame
        activePage="setup"
        setupReady={Boolean(props.baseline?.ok)}
        {...pageFrameHandlers.setup}
      >
        <OnboardingScreen
          baseline={props.baseline}
          loading={props.baselineLoading}
          onCreateAgent={() => props.setCreateOpen(true)}
          onOpenSettings={() => props.setSettingsOpen(true)}
          onRefresh={props.loadBaseline}
        />
      </DashboardPageFrame>
    );
  }

  return (
    <DashboardPageFrame
      activePage="dashboard"
      setupReady={Boolean(props.baseline?.ok)}
      {...pageFrameHandlers.dashboard}
      cardCompact={instances.length <= 2}
      aria-label="Agent inventory"
    >
      <DashboardPageStack
        className="fleet-inventory-stack"
        title="Fleet"
        description={hasAgents ? `${unit(instances.length, "agent")} across ${unit(nodeCount, "node")}` : "Create an agent to start using this console."}
        hideHeader
      >
        <div className="fleet-stats-strip" aria-label="Fleet metrics">
          <FleetMetric label="Agents ready" value={ratio(runningAgents, instances.length)} detail={runningAgents >= instances.length ? "All running" : unit(instances.length - runningAgents, "stopped agent")} trend={runningAgents >= instances.length ? "steady" : "attention"} series={runningAgentSeries} seriesLabel={metricSeriesLabel("Running agents", runningAgentSeries)} />
          <FleetMetric label="Service health" value={`${snapshot.serviceHealth}%`} detail={serviceCount ? `${runningServices}/${serviceCount} online` : "No services"} trend={serviceCount && runningServices < serviceCount ? "attention" : "steady"} series={serviceHealthSeries} seriesLabel={metricSeriesLabel("Service health", serviceHealthSeries, "%")} suffix="%" />
          <FleetMetric label="Active jobs" value={String(activeJobCount)} detail={activeJobCount ? "In progress" : "Quiet"} trend={activeJobCount ? "active" : "steady"} series={activeJobSeries} seriesLabel={metricSeriesLabel("Active jobs", activeJobSeries)} />
          <FleetMetric label="Data health" value={`${snapshot.dataHealth}%`} detail={snapshot.dataHealth < 100 ? "Check memory, providers" : "Memory, providers OK"} trend={snapshot.dataHealth < 100 ? "attention" : "steady"} series={dataHealthSeries} seriesLabel={metricSeriesLabel("Data health", dataHealthSeries, "%")} suffix="%" />
        </div>
        {degraded ? (
          <DegradedGuidanceStrip
            instances={instances}
            onOpen={props.openAdvanced}
            onReviewSetup={() => props.setOnboardingOpen(true)}
          />
        ) : null}
        {instances.length > 0 ? (
          <FleetAgentTable
            jobs={activeJobs}
            instances={instances}
            onBackupAgent={props.backupAgent}
            onCaptureTemplate={props.captureAgentTemplate}
            onCloneAgent={props.cloneAgent}
            onMoveAgent={props.moveAgent}
            onRunAction={props.runAgentAction}
            onRenameAgent={props.renameAgent}
            onSelect={props.openAdvanced}
            fleetNodes={props.fleetNodes || []}
            pendingActions={props.pendingActions}
            selectedName={props.selected?.fleetKey || ""}
          />
        ) : (
          <EmptyAgents onboardingOpen={() => {
            setEmptyDashboardOpen(false);
            props.setOnboardingOpen(true);
          }} onCreateAgent={() => props.setCreateOpen(true)} />
        )}
      </DashboardPageStack>
    </DashboardPageFrame>
  );
}

const BUSINESS_AGENT_SEEDS = [
  ["revenue-ops", "Revenue Operations", "MacMini Studio", "openai-codex", "gpt-5.1-codex", 6, 6, "running"],
  ["finance-controller", "Finance Controller", "AWS us-east-1", "openai-codex", "gpt-5.1", 5, 5, "running"],
  ["customer-success", "Customer Success", "Azure UK South", "openrouter", "anthropic/claude-sonnet-4.5", 7, 6, "partial"],
  ["market-research", "Market Research", "GCP europe-west2", "openrouter", "google/gemini-2.5-pro", 4, 4, "running"],
  ["people-operations", "People Operations", "MacMini Rack", "openai-codex", "gpt-5-mini", 5, 5, "running"],
  ["legal-intake", "Legal Intake", "Azure East US", "openrouter", "mistralai/mistral-large-2411", 3, 3, "running"],
  ["procurement-desk", "Procurement Desk", "AWS eu-west-2", "openrouter", "openai/gpt-4.1", 6, 5, "partial"],
  ["executive-briefing", "Executive Briefing", "GCP us-central1", "openai-codex", "o3", 4, 4, "running"],
  ["sales-enablement", "Sales Enablement", "MacBook Pro M4", "openrouter", "meta-llama/llama-3.3-70b-instruct", 5, 5, "running"],
  ["compliance-monitor", "Compliance Monitor", "AWS ap-southeast-2", "openrouter", "qwen/qwen3-235b-a22b", 4, 3, "partial"],
  ["support-triage", "Support Triage", "Azure West Europe", "openai-codex", "gpt-4.1-mini", 8, 8, "running"],
  ["operations-planner", "Operations Planner", "Local Ollama", "ollama", "llama3.3:70b", 5, 0, "exited"],
  ["accounts-payable", "Accounts Payable", "GCP asia-southeast1", "openrouter", "deepseek/deepseek-r1", 4, 4, "running"],
  ["board-reporting", "Board Reporting", "AWS eu-central-1", "openai-codex", "gpt-5.1-codex-mini", 5, 5, "running"],
  ["partner-ops", "Partner Operations", "MacStudio Desk", "custom", "local-mixtral-8x22b", 4, 4, "running"],
  ["risk-analyst", "Risk Analyst", "Azure Canada Central", "openrouter", "x-ai/grok-4", 6, 5, "partial"],
] as const;

const BUSINESS_AGENT_PLACEHOLDERS: Instance[] = BUSINESS_AGENT_SEEDS.map(([name, displayName, nodeLabel, provider, model, serviceCount, runningServices, state], index) => {
  const nodeId = nodeLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const dashboardPort = 4200 + index;
  const webPort = 5200 + index;
  return {
    name,
    displayName,
    nodeId,
    nodeLabel,
    nodeLocal: index < 2,
    nodeStatus: "online",
    fleetKey: fleetKey(name, nodeId),
    state,
    services: Array.from({ length: serviceCount }, (_, serviceIndex) => ({
      name: `${name}-service-${serviceIndex + 1}`,
      state: serviceIndex < runningServices ? "running" : "stopped",
    })),
    serviceCount,
    runningServices,
    health: {
      dashboard: state === "running",
      camofox: runningServices > 0,
    },
    memory: {
      ok: runningServices > 0,
      provider,
      dataDir: `/demo/business/${name}`,
      pluginOk: true,
      fileCount: 80 + index * 17,
      totalBytes: 1450000 + index * 230000,
      checkedAt: new Date(Date.now() - index * 60000).toISOString(),
    },
    capabilities: {
      model: {
        ready: runningServices > 0,
        provider,
        model,
      },
      browser: {
        ready: runningServices > 1,
        client: "camofox",
      },
      workspace: {
        ready: true,
        workspace: true,
        git: true,
        projectContext: true,
      },
    },
    endpoints: {
      dashboard: `http://127.0.0.1:${dashboardPort}`,
      lanDashboard: `http://10.0.${index + 10}.12:${dashboardPort}`,
      web: `http://127.0.0.1:${webPort}`,
      lanWeb: `http://10.0.${index + 10}.12:${webPort}`,
    },
    ports: {
      dashboard: dashboardPort,
      health: 6200 + index,
      web: webPort,
      vnc: 5900 + index,
    },
    dependencies: {
      camofox: true,
    },
    runtime: "docker",
    network: {
      lanAddress: `10.0.${index + 10}.12`,
    },
    config: {
      provider,
      model,
    },
    update: {
      required: false,
      status: "current",
      versionsBehind: 0,
      currentRevision: "demo-placeholder",
      latestRevision: "demo-placeholder",
    },
    drift: {},
    timeline: [],
  };
});

const TREND_ICONS: Record<"up" | "down" | "flat", ComponentType<{ className?: string }>> = {
  up: ArrowUp,
  down: ArrowDown,
  flat: Minus,
};

function FleetMetric({ label, value, detail, trend, series, seriesLabel, suffix }: { label: string; value: string; detail: string; trend: "steady" | "active" | "attention"; series: number[]; seriesLabel: string; suffix?: string }) {
  const delta = trendDelta(series, suffix);
  const geometry = sparklineGeometry(series);
  const movement = delta && delta.direction !== "flat" ? delta : null;
  const TrendIcon = movement ? TREND_ICONS[movement.direction] : null;
  return (
    <div className={`fleet-stat-metric ${trend}`}>
      <div className="fleet-stat-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <div className="fleet-stat-meta">
          <small>{detail}</small>
          {movement && TrendIcon ? (
            <span className="fleet-stat-delta" title={`Trend: ${movement.direction} ${movement.delta}${suffix || ""}`}>
              <TrendIcon className="size-3" />
              {movement.delta}{suffix || ""}
            </span>
          ) : null}
        </div>
      </div>
      <svg viewBox={`0 0 ${geometry.width} ${geometry.height}`} preserveAspectRatio="none" role="img" aria-label={seriesLabel}>
        <title>{seriesLabel}</title>
        <line x1="0" y1={geometry.baseline} x2={geometry.width} y2={geometry.baseline} className="fleet-sparkline-baseline" />
        <polyline points={geometry.points} />
      </svg>
    </div>
  );
}

function DegradedGuidanceStrip({ instances, onOpen, onReviewSetup }: { instances: Instance[]; onOpen: (name?: string, nodeId?: string) => void; onReviewSetup: () => void }) {
  const attentionAgents = instances
    .filter((instance) => ["Degraded", "Stopped", "Unknown"].includes(stateLabel(instance)))
    .slice(0, 6);
  const activeAgents = instances
    .filter((instance) => ["Running", "Getting ready"].includes(stateLabel(instance)))
    .slice(0, 6);
  const shownAgents = attentionAgents.length ? attentionAgents : activeAgents;
  const activityOnly = !attentionAgents.length && activeAgents.length > 0;
  return (
    <section className={classNames("fleet-guidance-strip", activityOnly && "active")} aria-label={activityOnly ? "Fleet activity" : "Fleet needs attention"}>
      <div className="fleet-guidance-copy">
        <span className="fleet-guidance-title">
          {activityOnly ? null : <span className="fleet-status-dot warn" aria-hidden="true" />}
          {activityOnly
            ? `${activeAgents.length} agent${activeAgents.length === 1 ? " is" : "s are"} active`
            : attentionAgents.length ? `${attentionAgents.length} agent${attentionAgents.length === 1 ? "" : "s"} need attention` : "Some services need attention"}
        </span>
        {shownAgents.length ? (
          <div className="fleet-guidance-agents">
            {shownAgents.map((instance) => {
              const tone = stateTone(instance);
              return (
                <button
                  key={fleetKey(instance.name, instance.nodeId)}
                  type="button"
                  className={`fleet-guidance-chip ${tone}`}
                  onClick={() => onOpen(instance.name, instance.nodeId)}
                >
                  {activityOnly ? <RotateCw className="fleet-guidance-spinner" aria-hidden="true" /> : <span className={`fleet-status-dot ${tone}`} aria-hidden="true" />}
                  {agentDisplayName(instance)}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      {activityOnly ? null : (
        <Button variant="outline" size="sm" type="button" onClick={onReviewSetup} className="shrink-0">
          <Wrench data-icon="inline-start" />
          Review setup
        </Button>
      )}
    </section>
  );
}

function readStoredMetricHistory() {
  if (typeof window === "undefined") return [];
  try {
    return sanitizeFleetMetricHistory(JSON.parse(window.localStorage.getItem(FLEET_METRIC_HISTORY_KEY) || "[]"));
  } catch {
    return [];
  }
}

function writeStoredMetricHistory(history: FleetMetricSnapshot[]) {
  try {
    window.localStorage.setItem(FLEET_METRIC_HISTORY_KEY, JSON.stringify(history));
  } catch {
    // Non-essential history should never block the dashboard.
  }
}

function metricSeriesLabel(label: string, series: number[], suffix = "") {
  const first = formatSeriesValue(series[0] ?? 0, suffix);
  const last = formatSeriesValue(series.at(-1) ?? 0, suffix);
  const count = series.length;
  return `${label} trend: ${first} to ${last} across ${count} ${count === 1 ? "sample" : "samples"}`;
}

function formatSeriesValue(value: number, suffix: string) {
  return `${value}${suffix}`;
}

function EmptyAgents({ onboardingOpen, onCreateAgent }: { onboardingOpen: () => void; onCreateAgent: () => void }) {
  return (
    <div className="fleet-empty-state">
      <div className="fleet-empty-state-content">
        <div className="fleet-empty-state-icon">
          <svg viewBox="0 0 16 16" fill="none" className="size-10" aria-hidden="true">
            <path d="M8 1.5v13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M8 3.25c-2.35-1.4-4.7-.95-6.25.35 1.85-.2 3.8.2 5.55 1.55" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M8 3.25c2.35-1.4 4.7-.95 6.25.35-1.85-.2-3.8.2-5.55 1.55" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M8 13.25c-2.3-1-3.05-2.65-1.35-4.15-2 .8-2.35 2.95-.35 4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M8 13.25c2.3-1 3.05-2.65 1.35-4.15 2 .8 2.35 2.95.35 4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="8" cy="1.8" r="1.1" fill="currentColor" />
          </svg>
        </div>
        <h3 className="fleet-empty-state-title">No agents yet</h3>
        <p className="fleet-empty-state-desc">Set up your environment and create your first agent to get started.</p>
        <div className="fleet-empty-state-actions">
          <Button variant="outline" onClick={onboardingOpen}>
            <Wrench className="size-4" />
            Run setup checks
          </Button>
          <Button onClick={onCreateAgent}>
            <Plus className="size-4" />
            Create agent
          </Button>
        </div>
      </div>
    </div>
  );
}

type LifecycleAction = "start" | "stop" | "restart" | "update" | "delete";
type ConfirmableLifecycleAction = Exclude<LifecycleAction, "start">;

const LIFECYCLE_CONFIRMATION_COPY: Record<ConfirmableLifecycleAction, { title: string; description: string; actionLabel: string; variant?: "default" | "destructive" }> = {
  stop: { title: "Stop this agent?", description: "This will stop the agent container and interrupt active services until it is started again.", actionLabel: "Stop agent", variant: "destructive" },
  restart: { title: "Restart this agent?", description: "This will briefly take the agent offline while its services restart.", actionLabel: "Restart agent" },
  update: { title: "Update this agent?", description: "This will run the agent update workflow. The agent may be unavailable while the update completes.", actionLabel: "Update agent" },
  delete: { title: "Delete this agent?", description: "This permanently removes the agent from the fleet. This action cannot be undone.", actionLabel: "Delete agent", variant: "destructive" },
};

type SortKey = "agent" | "host" | "status" | "provider" | "services";
type SortDirection = "asc" | "desc";

const SORTABLE_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "agent", label: "Agent" },
  { key: "host", label: "Host" },
  { key: "status", label: "Status" },
  { key: "provider", label: "Provider" },
  { key: "services", label: "Services" },
];

function sortValue(instance: Instance, key: SortKey): string | number {
  switch (key) {
    case "agent":
      return (instance.displayName || instance.name).toLowerCase();
    case "host":
      return (instance.nodeLabel || "Local").toLowerCase();
    case "status": {
      const order: Record<string, number> = { Healthy: 0, Running: 1, "Getting ready": 2, Degraded: 3, Unknown: 4, Stopped: 5 };
      return order[stateLabel(instance)] ?? 9;
    }
    case "provider":
      return providerModel(instance).provider.toLowerCase();
    case "services":
      return instance.runningServices || 0;
    default:
      return 0;
  }
}

function FleetAgentTable({ instances, jobs, fleetNodes, onBackupAgent, onCaptureTemplate, onCloneAgent, onMoveAgent, onRenameAgent, onRunAction, onSelect, pendingActions, selectedName }: {
  instances: Instance[];
  jobs: Job[];
  fleetNodes: FleetNode[];
  onBackupAgent: (name: string, options: AgentBackupOptions, nodeId?: string) => Promise<void>;
  onCaptureTemplate: (name: string, options: AgentTemplateCaptureOptions, nodeId?: string) => Promise<void>;
  onCloneAgent: (name: string, options: AgentCloneOptions, nodeId?: string) => Promise<void>;
  onMoveAgent: (name: string, options: AgentMoveOptions, nodeId?: string) => Promise<void>;
  onRunAction: (name: string, action: string, nodeId?: string, confirmed?: boolean) => Promise<void>;
  onRenameAgent: (name: string, displayName: string, nodeId?: string) => Promise<void>;
  onSelect: (name: string, nodeId?: string) => void;
  pendingActions: Record<string, string>;
  selectedName: string;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [confirmTarget, setConfirmTarget] = useState<{ instance: Instance; action: ConfirmableLifecycleAction } | null>(null);
  const [backupTarget, setBackupTarget] = useState<Instance | null>(null);
  const [templateTarget, setTemplateTarget] = useState<Instance | null>(null);
  const [cloneTarget, setCloneTarget] = useState<Instance | null>(null);
  const [moveTarget, setMoveTarget] = useState<Instance | null>(null);
  const [renameTarget, setRenameTarget] = useState<Instance | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState<ConfirmableLifecycleAction | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const showSearch = instances.length > 5;
  const normalizedQuery = query.trim().toLowerCase();

  const visibleInstances = useMemo(() => {
    const filtered = normalizedQuery
      ? instances.filter((instance) => {
        const modelConfig = providerModel(instance);
        return [instance.displayName || "", instance.name, instance.nodeLabel || "Local", modelConfig.provider, modelConfig.model, stateLabel(instance)]
          .some((value) => value.toLowerCase().includes(normalizedQuery));
      })
      : [...instances];
    return filtered.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sortDirection === "asc" ? cmp : -cmp;
    });
  }, [instances, jobs, normalizedQuery, sortKey, sortDirection]);

  const confirmation = confirmTarget ? LIFECYCLE_CONFIRMATION_COPY[confirmTarget.action] : null;
  const bulkConfirmation = bulkConfirm ? LIFECYCLE_CONFIRMATION_COPY[bulkConfirm] : null;
  const selectableKeys = useMemo(() => new Set(visibleInstances.map((instance) => fleetKey(instance.name, instance.nodeId))), [visibleInstances]);
  const allSelected = selectableKeys.size > 0 && [...selectableKeys].every((key) => selectedKeys.has(key));
  const someSelected = selectedKeys.size > 0 && !allSelected;
  const selectedCount = [...selectedKeys].filter((key) => selectableKeys.has(key)).length;

  const toggleSort = useCallback((key: SortKey) => {
    setSortKey((current) => {
      if (current !== key) {
        setSortDirection("asc");
        return key;
      }
      setSortDirection((dir) => (dir === "asc" ? "desc" : "asc"));
      return current;
    });
  }, []);

  const toggleKey = useCallback((key: string, checked: boolean) => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const toggleAll = useCallback((checked: boolean) => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (checked) selectableKeys.forEach((key) => next.add(key));
      else selectableKeys.forEach((key) => next.delete(key));
      return next;
    });
  }, [selectableKeys]);

  const runBulkAction = useCallback((action: LifecycleAction) => {
    const targets = visibleInstances.filter((instance) => selectedKeys.has(fleetKey(instance.name, instance.nodeId)));
    if (!targets.length) return;
    if (action === "stop" || action === "restart" || action === "update" || action === "delete") {
      setBulkConfirm(action);
      return;
    }
    targets.forEach((instance) => {
      const nodeId = instance.nodeId || "local";
      if (!pendingActions[fleetKey(instance.name, nodeId)]) {
        onRunAction(instance.name, action, nodeId, true);
      }
    });
  }, [visibleInstances, selectedKeys, pendingActions, onRunAction]);

  const confirmBulkAction = useCallback(async () => {
    if (!bulkConfirm) return;
    const action = bulkConfirm;
    setBulkConfirm(null);
    const targets = visibleInstances.filter((instance) => selectedKeys.has(fleetKey(instance.name, instance.nodeId)));
    for (const instance of targets) {
      const nodeId = instance.nodeId || "local";
      if (!pendingActions[fleetKey(instance.name, nodeId)]) {
        await onRunAction(instance.name, action, nodeId, true);
      }
    }
    setSelectedKeys(new Set());
  }, [bulkConfirm, visibleInstances, selectedKeys, pendingActions, onRunAction]);

  function requestAction(instance: Instance, action: LifecycleAction) {
    const nodeId = instance.nodeId || "local";
    const key = fleetKey(instance.name, nodeId);
    if (pendingActions[key]) return;
    if (action === "start") {
      onRunAction(instance.name, action, nodeId, true);
      return;
    }
    setConfirmTarget({ instance, action });
  }

  function confirmSelectedAction() {
    if (!confirmTarget) return;
    const target = confirmTarget;
    setConfirmTarget(null);
    onRunAction(target.instance.name, target.action, target.instance.nodeId || "local", true);
  }

  function toggleExpanded(key: string) {
    setExpanded((current) => ({ ...current, [key]: !current[key] }));
  }

  return (
    <>
      {selectedCount > 0 ? (
        <BulkActionBar
          count={selectedCount}
          pendingActions={pendingActions}
          selectedKeys={selectedKeys}
          instances={visibleInstances}
          onAction={runBulkAction}
          onClear={() => setSelectedKeys(new Set())}
        />
      ) : null}
      {showSearch ? (
        <div className="fleet-table-toolbar">
          <label className="fleet-search-field">
            <Search aria-hidden="true" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search agents" />
          </label>
          <span>{normalizedQuery ? `${visibleInstances.length}/${instances.length} shown` : unit(instances.length, "agent")}</span>
        </div>
      ) : null}
      <Table className="fleet-agent-table">
        <TableHeader>
          <TableRow>
            <TableHead className="fleet-checkbox-cell">
              <Checkbox
                ref={(el: HTMLInputElement | null) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                checked={allSelected}
                onChange={(event) => toggleAll(event.target.checked)}
                aria-label="Select all agents"
              />
            </TableHead>
            {SORTABLE_COLUMNS.map((column) => (
              <TableHead key={column.key} className={sortKey === column.key ? "sorted" : ""}>
                <button type="button" className="fleet-sort-button" onClick={() => toggleSort(column.key)}>
                  {column.label}
                  {sortKey === column.key ? (
                    sortDirection === "asc" ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />
                  ) : null}
                </button>
              </TableHead>
            ))}
            <TableHead className="fleet-hide-narrow">Browser</TableHead>
            <TableHead className="fleet-hide-narrow">Jobs</TableHead>
            <TableHead><span className="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleInstances.map((instance) => {
            const tone = stateTone(instance);
            const ready = isAgentReady(instance, jobs);
            const modelConfig = providerModel(instance);
            const nodeId = instance.nodeId || "local";
            const key = fleetKey(instance.name, nodeId);
            const selectedJobs = jobs.filter((job) => job.instance === instance.name && (
              (job.nodeId || "local") === nodeId
              || (job.action === "fleet-move" && job.payload?.sourceNodeId === nodeId)
            ));
            const activeJob = selectedJobs.find((job) => ["queued", "running"].includes(job.status));
            const pendingAction = pendingActions[key] || activeJob?.action || "";
            const isExpanded = Boolean(expanded[key]);
            const displayName = agentDisplayName(instance);
            const isSelected = selectedKeys.has(key);
            const row = (
                <TableRow className={classNames(selectedName === key && "selected", isSelected && "checked")} onClick={() => onSelect(instance.name, nodeId)}>
                  <TableCell className="fleet-checkbox-cell" onClick={(event) => event.stopPropagation()}>
                    <Checkbox checked={isSelected} onChange={(event) => toggleKey(key, event.target.checked)} aria-label={`Select ${instance.name}`} />
                  </TableCell>
                  <TableCell>
                    <button className="fleet-agent-name-button" type="button" aria-label={`Open ${instance.name}`} onClick={(event) => { event.stopPropagation(); onSelect(instance.name, nodeId); }}>
                      <span><Initials value={displayName} />{displayName}</span>
                      {!instance.displayName && !ready ? <small>Preparing</small> : null}
                    </button>
                  </TableCell>
                  <TableCell>
                    <span className={classNames("fleet-host-cell", instance.nodeStatus === "offline" && "offline")}>
                      <Network />
                      <span>{instance.nodeLabel || "Local"}</span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className={`fleet-status-cell ${tone}`}>
                      <span className={`fleet-status-dot ${tone}`} aria-hidden="true" />
                      {stateLabel(instance)}
                    </span>
                  </TableCell>
                  <TableCell className="fleet-provider-cell">
                    <span className="fleet-provider-copy" title={`${modelConfig.provider} ${modelConfig.model}`.trim()}>
                      <strong>{modelConfig.provider}</strong>
                      <small>{modelConfig.model}</small>
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className={classNames("fleet-service-meter", (instance.runningServices || 0) < (instance.serviceCount || 0) && "warn")}><strong>{instance.runningServices || 0}</strong><span>/</span>{instance.serviceCount || 0}</span>
                  </TableCell>
                  <TableCell className="fleet-hide-narrow">{instance.dependencies?.camofox ? <span className="fleet-metric-cell"><Globe2 />Ready</span> : <span className="fleet-metric-cell muted"><Globe2 />Off</span>}</TableCell>
                  <TableCell className="fleet-hide-narrow">{activeJob ? <span className="fleet-job-pill"><Clock />{activeJob.action} {Math.round(Number(activeJob.progress || 0))}%</span> : <span className="fleet-muted-copy">{selectedJobs.length ? `${selectedJobs.length} total` : "—"}</span>}</TableCell>
                  <TableCell className="fleet-manage-cell">
                    <Button variant="ghost" size="icon" type="button" aria-label={`${isExpanded ? "Collapse" : "Expand"} ${instance.name}`} onClick={(event) => { event.stopPropagation(); toggleExpanded(key); }}>
                      {isExpanded ? <ChevronDown /> : <ChevronRight />}
                    </Button>
                    <AgentActionMenu
                      instance={instance}
                      pendingAction={pendingAction}
                      onBackup={() => setBackupTarget(instance)}
                      onTemplate={() => setTemplateTarget(instance)}
                      onClone={() => setCloneTarget(instance)}
                      onMove={() => setMoveTarget(instance)}
                      onRename={() => setRenameTarget(instance)}
                      canOpenDetails={ready}
                      onOpen={() => onSelect(instance.name, nodeId)}
                      onRequestAction={(action) => requestAction(instance, action)}
                    />
                  </TableCell>
                </TableRow>
            );
            return (
              <Fragment key={key}>
                <ContextMenu>
                  <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
                  <AgentContextMenuContent
                    instance={instance}
                    pendingAction={pendingAction}
                    onBackup={() => setBackupTarget(instance)}
                    onTemplate={() => setTemplateTarget(instance)}
                    onClone={() => setCloneTarget(instance)}
                    onMove={() => setMoveTarget(instance)}
                    onRename={() => setRenameTarget(instance)}
                    canOpenDetails={ready}
                    onOpen={() => onSelect(instance.name, nodeId)}
                    onRequestAction={(action) => requestAction(instance, action)}
                  />
                </ContextMenu>
                {isExpanded ? (
                  <TableRow key={`${key}-details`} className="fleet-detail-row" onClick={(event) => event.stopPropagation()}>
                    <TableCell colSpan={9}>
                      <AgentExpandedDetails instance={instance} jobs={selectedJobs} />
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
      {showSearch && !visibleInstances.length ? (
        <div className="fleet-table-empty">No agents match this search.</div>
      ) : null}
      <AlertDialog open={Boolean(confirmTarget)} onOpenChange={(open) => { if (!open) setConfirmTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmation?.title || "Confirm action"}</AlertDialogTitle>
            <AlertDialogDescription>{confirmation?.description || "This action will be queued for the selected agent."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant={confirmation?.variant || "default"} onClick={confirmSelectedAction}>{confirmation?.actionLabel || "Continue"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={Boolean(bulkConfirm)} onOpenChange={(open) => { if (!open) setBulkConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{bulkConfirmation?.title.replace("this agent", `${selectedCount} agents`) || "Confirm bulk action"}</AlertDialogTitle>
            <AlertDialogDescription>{bulkConfirmation?.description || "This action will be queued for the selected agents."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant={bulkConfirmation?.variant || "default"} onClick={confirmBulkAction}>{bulkConfirmation?.actionLabel || "Continue"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {backupTarget ? <AgentBackupModal open selected={backupTarget} onClose={() => setBackupTarget(null)} onBackup={(name, options) => onBackupAgent(name, options, backupTarget.nodeId || "local")} /> : null}
      {templateTarget ? <AgentTemplateCaptureModal open selected={templateTarget} onClose={() => setTemplateTarget(null)} onCapture={(name, options) => onCaptureTemplate(name, options, templateTarget.nodeId || "local")} /> : null}
      {cloneTarget ? <AgentCloneModal open selected={cloneTarget} onClose={() => setCloneTarget(null)} onClone={(name, options) => onCloneAgent(name, options, cloneTarget.nodeId || "local")} /> : null}
      {moveTarget ? <AgentMoveModal open selected={moveTarget} instances={instances} fleetNodes={fleetNodes} onClose={() => setMoveTarget(null)} onMove={(name, options) => onMoveAgent(name, options, moveTarget.nodeId || "local")} /> : null}
      {renameTarget ? <AgentRenameModal open selected={renameTarget} onClose={() => setRenameTarget(null)} onRename={onRenameAgent} /> : null}
    </>
  );
}

function BulkActionBar({ count, pendingActions, selectedKeys, instances, onAction, onClear }: {
  count: number;
  pendingActions: Record<string, string>;
  selectedKeys: Set<string>;
  instances: Instance[];
  onAction: (action: LifecycleAction) => void;
  onClear: () => void;
}) {
  const anyPending = instances.some((instance) => {
    const key = fleetKey(instance.name, instance.nodeId);
    return selectedKeys.has(key) && Boolean(pendingActions[key]);
  });
  return (
    <div className="fleet-bulk-bar">
      <span className="fleet-bulk-count">{count} selected</span>
      <div className="fleet-bulk-actions">
        <Button variant="outline" size="sm" type="button" disabled={anyPending} onClick={() => onAction("start")}><Play className="size-3.5" />Start</Button>
        <Button variant="outline" size="sm" type="button" disabled={anyPending} onClick={() => onAction("stop")}><CircleStop className="size-3.5" />Stop</Button>
        <Button variant="outline" size="sm" type="button" disabled={anyPending} onClick={() => onAction("restart")}><RotateCw className="size-3.5" />Restart</Button>
        <Button variant="outline" size="sm" type="button" disabled={anyPending} onClick={() => onAction("update")}><Download className="size-3.5" />Update</Button>
      </div>
      <Button variant="ghost" size="sm" type="button" onClick={onClear}>Clear</Button>
    </div>
  );
}

function Initials({ value }: { value: string }) {
  const initials = value.split(/[\s_-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "A";
  return <i className="fleet-agent-initials" aria-hidden="true">{initials}</i>;
}

function AgentActionMenu({ instance, pendingAction, canOpenDetails, onBackup, onTemplate, onClone, onMove, onRename, onOpen, onRequestAction }: {
  instance: Instance;
  pendingAction: string;
  canOpenDetails: boolean;
  onBackup: () => void;
  onTemplate: () => void;
  onClone: () => void;
  onMove: () => void;
  onRename: () => void;
  onOpen: () => void;
  onRequestAction: (action: LifecycleAction) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" type="button" aria-label={`Open actions for ${instance.name}`} onClick={(event) => event.stopPropagation()}>
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="agent-action-menu" onClick={(event) => event.stopPropagation()}>
        <AgentMenuItems instance={instance} pendingAction={pendingAction} canOpenDetails={canOpenDetails} onBackup={onBackup} onTemplate={onTemplate} onClone={onClone} onMove={onMove} onRename={onRename} onOpen={onOpen} onRequestAction={onRequestAction} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AgentContextMenuContent({ instance, pendingAction, canOpenDetails, onBackup, onTemplate, onClone, onMove, onRename, onOpen, onRequestAction }: {
  instance: Instance;
  pendingAction: string;
  canOpenDetails: boolean;
  onBackup: () => void;
  onTemplate: () => void;
  onClone: () => void;
  onMove: () => void;
  onRename: () => void;
  onOpen: () => void;
  onRequestAction: (action: LifecycleAction) => void;
}) {
  return (
    <ContextMenuContent className="agent-action-menu">
      <ContextMenuLabel>Agent actions</ContextMenuLabel>
      <ContextMenuItem disabled={!canOpenDetails} onSelect={onOpen}><ExternalLink />{canOpenDetails ? "Open details" : "Details unavailable"}</ContextMenuItem>
      <ContextMenuItem onSelect={onRename}><Edit3 />Rename display</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem disabled={Boolean(pendingAction)} onSelect={() => onRequestAction("start")}><Play />Start</ContextMenuItem>
      <ContextMenuItem disabled={Boolean(pendingAction)} onSelect={() => onRequestAction("stop")} variant="destructive"><CircleStop />Stop</ContextMenuItem>
      <ContextMenuItem disabled={Boolean(pendingAction)} onSelect={() => onRequestAction("restart")}><RotateCw />Restart</ContextMenuItem>
      <ContextMenuItem disabled={Boolean(pendingAction)} onSelect={() => onRequestAction("update")}><Download />Update</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={onBackup}><Archive />Back up</ContextMenuItem>
      <ContextMenuItem disabled={instance.nodeLocal === false || instance.runtime === "nemoclaw"} onSelect={onTemplate}><Library />Save as template</ContextMenuItem>
      <ContextMenuItem onSelect={onClone}><CopyPlus />Clone</ContextMenuItem>
      <ContextMenuItem onSelect={onMove}><MoveRight />Move</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem disabled={Boolean(pendingAction)} onSelect={() => onRequestAction("delete")} variant="destructive"><Trash2 />Delete</ContextMenuItem>
    </ContextMenuContent>
  );
}

function AgentMenuItems({ instance, pendingAction, canOpenDetails, onBackup, onTemplate, onClone, onMove, onRename, onOpen, onRequestAction }: {
  instance: Instance;
  pendingAction: string;
  canOpenDetails: boolean;
  onBackup: () => void;
  onTemplate: () => void;
  onClone: () => void;
  onMove: () => void;
  onRename: () => void;
  onOpen: () => void;
  onRequestAction: (action: LifecycleAction) => void;
}) {
  return (
    <>
      <DropdownMenuLabel>Agent actions</DropdownMenuLabel>
      <DropdownMenuItem disabled={!canOpenDetails} onSelect={onOpen}><ExternalLink />{canOpenDetails ? "Open details" : "Details unavailable"}</DropdownMenuItem>
      <DropdownMenuItem onSelect={onRename}><Edit3 />Rename display</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={Boolean(pendingAction)} onSelect={() => onRequestAction("start")}><Play />Start</DropdownMenuItem>
      <DropdownMenuItem disabled={Boolean(pendingAction)} onSelect={() => onRequestAction("stop")} variant="destructive"><CircleStop />Stop</DropdownMenuItem>
      <DropdownMenuItem disabled={Boolean(pendingAction)} onSelect={() => onRequestAction("restart")}><RotateCw />Restart</DropdownMenuItem>
      <DropdownMenuItem disabled={Boolean(pendingAction)} onSelect={() => onRequestAction("update")}><Download />Update</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onBackup}><Archive />Back up</DropdownMenuItem>
      <DropdownMenuItem disabled={instance.nodeLocal === false || instance.runtime === "nemoclaw"} onSelect={onTemplate}><Library />Save as template</DropdownMenuItem>
      <DropdownMenuItem onSelect={onClone}><CopyPlus />Clone</DropdownMenuItem>
      <DropdownMenuItem onSelect={onMove}><MoveRight />Move</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={Boolean(pendingAction)} onSelect={() => onRequestAction("delete")} variant="destructive"><Trash2 />Delete</DropdownMenuItem>
    </>
  );
}

function AgentExpandedDetails({ instance, jobs }: { instance: Instance; jobs: Job[] }) {
  const update = updateMeta(instance);
  const groups = [
    {
      label: "Network",
      tiles: [
        { icon: Network, label: "LAN", value: `${instance.network?.lanAddress || "127.0.0.1"}:${instance.ports?.health || "n/a"}` },
        { icon: Globe2, label: "Dashboard", value: instance.endpoints?.lanDashboard || instance.endpoints?.dashboard || "Unavailable" },
        { icon: ExternalLink, label: "Web", value: instance.endpoints?.web || "No web endpoint" },
      ],
    },
    {
      label: "Resources",
      tiles: [
        { icon: HardDrive, label: "Ports", value: `Dashboard ${instance.ports?.dashboard || "n/a"} · Web ${instance.ports?.web || "n/a"} · VNC ${instance.ports?.vnc || "off"}` },
        { icon: Download, label: "Revision", value: `${instance.update?.currentRevision || "Unknown"} → ${instance.update?.latestRevision || "Unknown"}`, tone: update.variant === "warning" ? "warn" as const : "default" as const },
        { icon: MemoryStick, label: "Memory", value: `${instance.memory?.provider || "No provider"} · ${instance.memory?.fileCount || 0} files · ${formatBytes(instance.memory?.totalBytes || 0)}` },
      ],
    },
    {
      label: "Jobs",
      tiles: [
        { icon: BriefcaseBusiness, label: "Jobs", value: jobs.length ? `${jobs.length} tracked job${jobs.length === 1 ? "" : "s"}` : "No recent jobs" },
      ],
    },
  ];
  return (
    <div className="fleet-expanded-panel">
      {groups.map((group) => (
        <div key={group.label} className="fleet-detail-group">
          <span className="fleet-detail-group-label">{group.label}</span>
          <div className="fleet-detail-tiles">
            {group.tiles.map((tile) => (
              <DetailTile key={tile.label} icon={tile.icon} label={tile.label} value={tile.value} tone={tile.tone || "default"} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function agentDisplayName(instance: Instance) {
  return String(instance.displayName || "").trim() || instance.name;
}

function DetailTile({ icon: Icon, label, value, tone = "default" }: { icon: ComponentType<{ className?: string }>; label: string; value: string; tone?: "default" | "warn" }) {
  const href = externalHref(value);
  return (
    <div className={classNames("fleet-detail-tile", tone)}>
      <Icon />
      <span>{label}</span>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" title={value} onClick={(event) => event.stopPropagation()}>
          <strong>{value}</strong>
          <ExternalLink aria-hidden="true" />
        </a>
      ) : (
        <strong title={value}>{value}</strong>
      )}
    </div>
  );
}

function externalHref(value: string) {
  const text = value.trim();
  if (!/^https?:\/\//i.test(text)) return "";
  try {
    return new URL(text).toString();
  } catch {
    return "";
  }
}

function updateMeta(instance: Instance): { label: string; variant: "success" | "warning" | "secondary" } {
  const versionsBehind = instance.update?.versionsBehind;
  const status = instance.update?.status || "unknown";
  if (status === "reversion") return { label: "Ahead", variant: "warning" };
  if (typeof versionsBehind !== "number") return { label: "Unknown", variant: "secondary" };
  if (versionsBehind === 0) return { label: "Current", variant: "success" };
  return { label: `${versionsBehind} behind`, variant: "warning" };
}

function formatBytes(value: number) {
  if (!value) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function providerModel(instance: Instance) {
  const capability = instance.capabilities?.model || {};
  const provider = String(instance.config?.provider || capability.provider || "").trim();
  const model = String(instance.config?.model || capability.model || "").trim();
  return {
    provider: providerLabel(provider),
    model: model || "No model set",
  };
}

function providerLabel(provider: string) {
  switch (provider) {
    case "openai-codex":
      return "OpenAI Codex";
    case "openrouter":
      return "OpenRouter";
    case "ollama":
      return "Ollama";
    case "custom":
      return "Custom endpoint";
    case "":
      return "No provider";
    default:
      return provider;
  }
}
