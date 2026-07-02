export type Job = {
  id: number;
  action: string;
  instance: string;
  status: string;
  progress: number;
  payload?: Record<string, unknown>;
  output?: string;
  error?: string;
  result?: Record<string, any>;
  createdAt?: string;
  nodeId?: string;
  nodeLabel?: string;
  nodeLocal?: boolean;
  nodeStatus?: string;
  fleetKey?: string;
};

export type CreateAgentOptions = {
  camofox: boolean;
  nodeId?: string;
  runtime: "docker" | "nemoclaw";
  templateLibraryId?: string;
  capabilities?: {
    codexCli?: boolean;
    payments?: boolean;
    sharedMemory?: boolean;
  };
  telegram?: {
    enabled: boolean;
    botToken?: string;
    botUsername?: string;
    trustedUserId?: string;
    allowedUserIds?: string[];
    homeChannel?: string;
  };
  contextFiles?: {
    soul?: string;
    project?: {
      filename: "AGENTS.md" | ".hermes.md" | "HERMES.md" | "CLAUDE.md" | ".cursorrules";
      content: string;
    };
  };
};

export type TelegramAgentOptions = {
  enabled: true;
  botToken: string;
  botUsername?: string;
  trustedUserId: string;
  allowedUserIds: string[];
  homeChannel: string;
};

export type Instance = {
  name: string;
  displayName?: string;
  nodeId?: string;
  nodeLabel?: string;
  nodeLocal?: boolean;
  nodeStatus?: string;
  fleetKey?: string;
  state: string;
  pendingCreate?: boolean;
  pendingJobId?: number | null;
  pendingJobStatus?: string;
  pendingJobProgress?: number;
  services: any[];
  serviceCount: number;
  runningServices: number;
  health: Record<string, any>;
  memory: {
    ok?: boolean;
    provider?: string;
    dataDir?: string;
    pluginOk?: boolean;
    fileCount?: number;
    totalBytes?: number;
    lastWrite?: string;
    checkedAt?: string;
  };
  capabilities: Record<string, {
    ready?: boolean;
    provider?: string;
    model?: string;
    client?: string;
    account?: string;
    command?: string;
    package?: string;
    path?: string;
    skill?: string;
    clientPath?: string;
    policy?: PaymentPolicy | null;
    workspace?: boolean;
    git?: boolean;
    projectContext?: boolean;
    soul?: boolean;
    lastWrite?: string;
  }>;
  endpoints: { dashboard?: string; lanDashboard?: string; vnc?: string; lanVnc?: string; web?: string; lanWeb?: string };
  ports: { dashboard?: number; vnc?: number; health?: number; web?: number };
  dependencies: { camofox?: boolean };
  runtime?: "docker" | "nemoclaw";
  network: Record<string, any>;
  config: Record<string, any>;
  update: {
    required?: boolean;
    status?: string;
    versionsBehind?: number | null;
    currentRevision?: string;
    latestRevision?: string;
    reason?: string;
  };
  drift: Record<string, any>;
  timeline: any[];
};

export type GatewaySurface = "dashboard" | "vnc" | "web" | "terminal" | "chatHistory";

type GatewaySurfaceDiagnostic = {
  advertisedUrl: string;
  effectiveUrl: string;
  reachable: boolean;
  httpStatus: number | null;
  reason: string;
  checkedAt: string;
};

export type GatewayDiagnostics = Record<GatewaySurface, GatewaySurfaceDiagnostic> & {
  checkedAt?: string;
  hints?: string[];
  remote?: Record<string, unknown>;
  runtime?: Record<string, unknown>;
};

export type GatewayResponse = Instance["endpoints"] & {
  proxy?: Record<string, string>;
  dashboardAuth?: {
    username?: string;
    password?: string;
    available?: boolean;
    reason?: string;
    source?: string;
  };
  dashboardUnavailable?: boolean;
  diagnostics?: GatewayDiagnostics;
};

type PaymentPolicy = {
  enabled: boolean;
  currency: string;
  taskBudget: number;
  approvalThreshold: number;
  requireApproval: boolean;
  defaultAccount: string;
  notes: string;
  updatedAt: string;
};

export type Session = {
  id: string;
  title: string;
  source: string;
  model: string;
  messageCount: number;
  startedAt: string;
  lastActive: string;
  active: boolean;
};

export type CronEntry = {
  path: string;
  size: number;
  modifiedAt: string;
  content: string;
  truncated?: boolean;
};

export type Message = {
  id: string;
  role: string;
  source?: string;
  model?: string;
  content: string;
  createdAt: string;
  pending?: boolean;
};

export type ChatRunStatus = {
  mode: "api-run";
  runId: string;
  status: string;
  sessionId?: string;
  output?: string;
  model?: string;
  usage?: Record<string, unknown> | null;
};

export type ChatSendResponse = {
  mode: "api-run" | "job";
  status: string;
  sessionId?: string;
  runId?: string;
  canStop?: boolean;
  transport?: string;
  job?: Job;
  messages?: Message[];
};

export type ProviderConfig = {
  provider: string;
  model: string;
  baseUrl: string;
  customEndpoints?: string[];
};

export type AgentSyncTarget = {
  nodeId: string;
  name: string;
};

export type ProviderCatalogItem = {
  id: string;
  label: string;
  description: string;
  authType: "api_key" | "api_key_optional" | "oauth_device_code" | "oauth_external" | "none";
  credentialKeys: string[];
  baseUrlEnvKey: string;
  baseUrl: string;
  models: string[];
};

export type FleetNode = {
  id: string;
  label: string;
  baseUrl: string;
  enabled: boolean;
  local: boolean;
  status: string;
  error?: string;
  tokenConfigured?: boolean;
  redactedToken?: string;
  checkedAt?: string;
  console?: {
    version?: string;
    revision?: string;
    label?: string;
  } | null;
};

export const LOCAL_FLEET_NODE: FleetNode = {
  id: "local",
  label: "Local Docker",
  baseUrl: "http://127.0.0.1:5180",
  enabled: true,
  local: true,
  status: "online",
};

export const AGENT_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?$/;
export const NEMOCLAW_AGENT_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function slugifyAgentName(value: string, options: { allowUnderscore?: boolean } = {}) {
  const allowUnderscore = options.allowUnderscore !== false;
  return value
    .trim()
    .toLowerCase()
    .replace(allowUnderscore ? /[^a-z0-9_-]+/g : /[^a-z0-9-]+/g, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
    .slice(0, 63);
}

export type ProviderCatalog = {
  providers: ProviderCatalogItem[];
  source?: string;
  error?: string;
};

export type OAuthSession = {
  id: string;
  provider: string;
  status: "pending" | "complete" | "failed";
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  interval: number;
  error?: string;
};

export type OAuthCredentialSummary = {
  provider: string;
  label: string;
  savedAt: string;
  synced: boolean;
  syncedAt: string;
};

export type GlobalConfig = {
  provider: ProviderConfig | null;
  credentials: Array<{ key: string; redacted: string; sensitive: boolean }>;
  oauthCredentials: OAuthCredentialSummary[];
  lastSyncedAt?: string;
  requiresSync: boolean;
};

export type BaselineCheck = {
  ok: boolean;
  label: string;
  detail: string;
  fix: string;
  severity: "error" | "warn";
};

export type BaselineStatus = {
  ok: boolean;
  appRoot: string;
  loadedEnvFiles: string[];
  resolved: Record<string, string>;
  checks: BaselineCheck[];
  errors: BaselineCheck[];
  warnings: BaselineCheck[];
};

export type BackupArchive = {
  file: string;
  path: string;
  size: number;
  createdAt: string;
  modifiedAt: string;
};

type BackupManifest = {
  version: number;
  createdAt: string;
  scope: string;
  includeSecrets: boolean;
  includeWorkspace: boolean;
  global: Record<string, unknown>;
  agents: Array<{ name: string; dependencies: { camofox?: boolean }; includeWorkspace?: boolean; copiedSecrets?: boolean }>;
};

export type BackupInspectResult = {
  manifest: BackupManifest;
  conflicts: string[];
};

export type AgentBackupOptions = {
  includeSecrets: boolean;
  includeWorkspace: boolean;
};

export type AgentCloneOptions = {
  newName: string;
  copyWorkspace: boolean;
  copyCredentials: boolean;
  start: boolean;
};

export type AgentMoveOptions = {
  targetNodeId: string;
  includeWorkspace: boolean;
  includeSecrets: boolean;
  startTarget: boolean;
  removeSource: boolean;
};

type TemplateRequirement = {
  type: string;
  key: string;
  label: string;
};

type TemplateRequirements = {
  envKeys?: string[];
  oauthProviders?: string[];
  capabilities?: {
    codexCli?: boolean;
    payments?: boolean;
    sharedMemory?: boolean;
    telegram?: boolean;
  };
};

export type TemplateRequirementCheck = {
  ok: boolean;
  missing: TemplateRequirement[];
};

export type AgentTemplateLibraryItem = {
  id: string;
  name: string;
  description: string;
  sourceInstance: string;
  sourceNodeId: string;
  archive: {
    file: string;
    path: string;
    size: number;
  };
  manifest: Record<string, any>;
  requirements: TemplateRequirements;
  createdAt: string;
  updatedAt: string;
};

export type AgentTemplateCaptureOptions = {
  sourceNodeId?: string;
  name: string;
  description: string;
  includeWorkspace: boolean;
};

export const EMPTY_GLOBAL_CONFIG: GlobalConfig = {
  provider: null,
  credentials: [],
  oauthCredentials: [],
  requiresSync: true,
};
