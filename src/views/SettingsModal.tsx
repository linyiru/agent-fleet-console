import { Archive, Brain, KeyRound, Library, Network, Settings2, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import type { AgentSyncTarget, FleetNode, GlobalConfig, Instance, OAuthSession, ProviderCatalog, ProviderConfig } from "../models/fleet.ts";
import { api, apiErrorMessage, deleteJson, postJson } from "../controllers/api.ts";
import { Button } from "../components/ui/button.tsx";
import { toast } from "sonner";
import { DashboardPageStack } from "../components/layout/FleetShell.tsx";
import { credentialKeyError } from "../controllers/credentials.ts";
import { SettingsProvidersTab } from "./SettingsProvidersTab.tsx";
import { BackupRestorePanel } from "./BackupRestorePanel.tsx";
import { SettingsFleetNodesTab } from "./SettingsFleetNodesTab.tsx";
import { SettingsSharedMemoryTab } from "./SettingsSharedMemoryTab.tsx";
import { TemplateLibraryPanel } from "./TemplateLibraryPanel.tsx";
import { classNames } from "../controllers/format.ts";

const MIN_PENDING_MS = 350;
const DEFAULT_PROVIDER: ProviderConfig = { provider: "openai-codex", model: "gpt-5.5", baseUrl: "https://chatgpt.com/backend-api/codex" };
const SETTINGS_SECTIONS = ["provider", "credentials", "memory", "templates", "nodes", "backups"] as const;
type SettingsSection = typeof SETTINGS_SECTIONS[number];

type SettingsScreenProps = {
  fleetNodes: FleetNode[];
  globalConfig: GlobalConfig;
  providerCatalog: ProviderCatalog;
  instances: Instance[];
  onRefreshFleet: () => Promise<void>;
  onSaveProvider: (provider: ProviderConfig) => Promise<void>;
  onSaveCredential: (key: string, value: string) => Promise<void>;
  onRefreshGlobalConfig: () => Promise<void>;
  onSync: (targets?: AgentSyncTarget[]) => Promise<void>;
  onClose?: () => void;
  showCloseButton?: boolean;
};

function pendingDelay() {
  return new Promise((resolve) => window.setTimeout(resolve, MIN_PENDING_MS));
}

function isSettingsSection(value: string): value is SettingsSection {
  return SETTINGS_SECTIONS.includes(value as SettingsSection);
}

function readInitialSettingsSection(): SettingsSection {
  if (typeof window === "undefined") return "provider";
  const params = new URLSearchParams(window.location.search);
  const value = (params.get("settingsSection") || params.get("section") || "").trim().toLowerCase();
  return isSettingsSection(value) ? value : "provider";
}

function writeSettingsSection(section: SettingsSection) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const params = url.searchParams;
  if (params.get("view") !== "settings" && !params.has("settingsSection") && !params.has("section")) return;
  params.set("view", "settings");
  params.set("settingsSection", section);
  params.delete("section");
  window.history.replaceState(null, "", url);
}

export function SettingsScreen({
  fleetNodes,
  globalConfig,
  instances,
  providerCatalog,
  onRefreshFleet,
  onSaveProvider,
  onSaveCredential,
  onRefreshGlobalConfig,
  onSync,
  onClose,
  showCloseButton,
}: SettingsScreenProps) {
  const [provider, setProvider] = useState(globalConfig.provider || DEFAULT_PROVIDER);
  const [credential, setCredential] = useState({ key: "", value: "" });
  const [oauthSession, setOauthSession] = useState<OAuthSession | null>(null);
  const [activeSection, setActiveSection] = useState<SettingsSection>(readInitialSettingsSection);
  const [busyAction, setBusyAction] = useState("");
  const busy = Boolean(busyAction);
  const remoteNodeCount = useMemo(() => fleetNodes.filter((node) => !node.local).length, [fleetNodes]);
  useEffect(() => setProvider(globalConfig.provider || DEFAULT_PROVIDER), [globalConfig.provider]);

  const chooseSection = useCallback((section: SettingsSection) => {
    setActiveSection(section);
    writeSettingsSection(section);
  }, []);

  useEffect(() => {
    if (!oauthSession || oauthSession.status !== "pending") return;
    let cancelled = false;
    async function pollSession() {
      try {
        const data = await api<{ session: OAuthSession }>(`/api/global-config/oauth/${encodeURIComponent(oauthSession.provider)}/${encodeURIComponent(oauthSession.id)}`);
        if (cancelled) return;
        setOauthSession(data.session);
        if (data.session.status === "complete") {
          await onRefreshGlobalConfig();
          toast.success("Codex login saved", { description: "Sync Codex auth to agents when you are ready." });
        } else if (data.session.status === "failed") {
          toast.error("Codex login failed", { description: data.session.error || "Start a new device login and try again." });
        }
      } catch (error: unknown) {
        if (!cancelled) toast.error("Could not check Codex login", { description: apiErrorMessage(error) });
      }
    }
    const timer = window.setInterval(pollSession, Math.max(3000, Number(oauthSession.interval || 5) * 1000));
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [oauthSession?.id, oauthSession?.status]);

  async function saveProvider(event: FormEvent) {
    event.preventDefault();
    setBusyAction("provider");
    try {
      await Promise.all([onSaveProvider(provider), pendingDelay()]);
      toast.success("Provider saved", { description: "New agents will inherit this model configuration." });
    } finally {
      setBusyAction("");
    }
  }

  async function saveCredential(event: FormEvent) {
    event.preventDefault();
    const keyError = credentialKeyError(credential.key);
    if (keyError) {
      toast.error("Credential key is invalid", { description: keyError });
      return;
    }
    if (/[\n\r\0]/.test(credential.value)) {
      toast.error("Credential value is invalid", { description: "Credential values must be a single line." });
      return;
    }
    setBusyAction("credential");
    try {
      await Promise.all([onSaveCredential(credential.key, credential.value), pendingDelay()]);
      setCredential({ key: "", value: "" });
      toast.success("Credential saved", { description: "Agents can inherit this secret after sync." });
    } catch (error: unknown) {
      toast.error("Could not save credential", { description: apiErrorMessage(error, "Check the key and value, then try again.") });
    } finally {
      setBusyAction("");
    }
  }

  async function removeCredential(key: string) {
    setBusyAction(`remove:${key}`);
    try {
      await Promise.all([
        (async () => { await deleteJson(`/api/global-config/credentials/${encodeURIComponent(key)}`); await onSync(); })(),
        pendingDelay(),
      ]);
      toast.success("Credential removed", { description: "Agent sync has been queued." });
    } finally {
      setBusyAction("");
    }
  }

  async function startOauth() {
    setBusyAction("oauth");
    try {
      const [data] = await Promise.all([postJson<{ session: OAuthSession }>("/api/global-config/oauth/start", { provider: provider.provider }), pendingDelay()]);
      setOauthSession(data.session);
      toast.info("Device login started", { description: "Use the code and login link shown in Fleet settings." });
    } finally {
      setBusyAction("");
    }
  }

  async function sync(targets: AgentSyncTarget[] = []) {
    setBusyAction("sync");
    try {
      await Promise.all([onSync(targets), pendingDelay()]);
      toast.success(targets.length ? "Selected agents synced" : "Agents synced", { description: "Running agents were restarted so Codex auth is loaded." });
    } finally {
      setBusyAction("");
    }
  }

  return (
    <DashboardPageStack
      className="settings-layout settings-page-layout"
      leading={<span className="settings-eyebrow">Fleet control</span>}
      title="Fleet settings"
      description="Defaults, credentials, and portability for every agent."
      hideHeader
      actions={showCloseButton && onClose ? (
        <Button variant="outline" size="icon" aria-label="Close settings" onClick={onClose}><X data-icon="inline-start" /></Button>
      ) : null}
    >
      <div className="settings-shell">
        <aside className="settings-rail" aria-label="Settings sections">
          <SettingsRailButton
            active={activeSection === "provider"}
            detail={globalConfig.requiresSync ? "Sync required" : "In sync"}
            icon={Settings2}
            label="Model & auth"
            onClick={() => chooseSection("provider")}
            tone={globalConfig.requiresSync ? "warning" : "success"}
          />
          <SettingsRailButton
            active={activeSection === "credentials"}
            detail={`${globalConfig.credentials.length} API keys`}
            icon={KeyRound}
            label="Credentials"
            onClick={() => chooseSection("credentials")}
          />
          <SettingsRailButton
            active={activeSection === "memory"}
            detail="Cross-agent knowledge"
            icon={Brain}
            label="Shared memory"
            onClick={() => chooseSection("memory")}
          />
          <SettingsRailButton
            active={activeSection === "templates"}
            detail="Reusable agents"
            icon={Library}
            label="Templates"
            onClick={() => chooseSection("templates")}
          />
          <SettingsRailButton
            active={activeSection === "backups"}
            detail={`${instances.length} agents`}
            icon={Archive}
            label="Backups"
            onClick={() => chooseSection("backups")}
          />
          <SettingsRailButton
            active={activeSection === "nodes"}
            detail={`1 local · ${remoteNodeCount} remote`}
            icon={Network}
            label="Fleet nodes"
            onClick={() => chooseSection("nodes")}
          />
        </aside>
        <div className="settings-workspace">
          {activeSection === "backups" ? (
            <BackupRestorePanel instances={instances} />
          ) : activeSection === "templates" ? (
            <TemplateLibraryPanel instances={instances} fleetNodes={fleetNodes} onRefreshFleet={onRefreshFleet} />
          ) : activeSection === "memory" ? (
            <SettingsSharedMemoryTab instances={instances} />
          ) : activeSection === "nodes" ? (
            <SettingsFleetNodesTab nodes={fleetNodes} onRefresh={onRefreshFleet} />
          ) : (
            <SettingsProvidersTab
              busy={busy}
              busyAction={busyAction}
              credential={credential}
              globalConfig={globalConfig}
              fleetNodes={fleetNodes}
              instances={instances}
              oauthSession={oauthSession}
              provider={provider}
              providerCatalog={providerCatalog}
              removeCredential={removeCredential}
              saveCredential={saveCredential}
              saveProvider={saveProvider}
              section={activeSection}
              setCredential={setCredential}
              setProvider={setProvider}
              startOauth={startOauth}
              sync={sync}
            />
          )}
        </div>
      </div>
    </DashboardPageStack>
  );
}

function SettingsRailButton({
  active,
  detail,
  icon: Icon,
  label,
  onClick,
  tone = "neutral",
}: {
  active: boolean;
  detail: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  tone?: "neutral" | "success" | "warning";
}) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={classNames("settings-rail-button", `tone-${tone}`, active && "active")}
      type="button"
      onClick={onClick}
    >
      <span className="settings-rail-marker" aria-hidden="true" />
      <Icon className="settings-rail-icon" />
      <span className="settings-rail-copy">
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
    </button>
  );
}
