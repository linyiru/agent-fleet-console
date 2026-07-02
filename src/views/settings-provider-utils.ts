import type { Dispatch, FormEvent, SetStateAction } from "react";
import type { AgentSyncTarget, FleetNode, GlobalConfig, Instance, OAuthSession, ProviderCatalog, ProviderCatalogItem, ProviderConfig } from "../models/fleet.ts";

type CredentialDraft = { key: string; value: string };
export const CUSTOM_ENDPOINT_LIMIT = 12;

export type SettingsProvidersTabProps = {
  busy: boolean;
  busyAction: string;
  credential: CredentialDraft;
  fleetNodes: FleetNode[];
  globalConfig: GlobalConfig;
  instances: Instance[];
  oauthSession: OAuthSession | null;
  provider: ProviderConfig;
  providerCatalog: ProviderCatalog;
  removeCredential: (key: string) => Promise<void>;
  saveCredential: (event: FormEvent) => Promise<void>;
  saveProvider: (event: FormEvent) => Promise<void>;
  setCredential: Dispatch<SetStateAction<CredentialDraft>>;
  setProvider: Dispatch<SetStateAction<ProviderConfig>>;
  startOauth: () => Promise<void>;
  sync: (targets?: AgentSyncTarget[]) => Promise<void>;
  section?: "provider" | "credentials" | "all";
};

export type SyncTargetPickerProps = {
  disabled?: boolean;
  emptyDescription?: string;
  selectableAgents: Instance[];
  selectedSyncKeySet: ReadonlySet<string>;
  selectedSyncKeys: string[];
  selectedTargets: AgentSyncTarget[];
  setSelectedSyncKeys: Dispatch<SetStateAction<string[]>>;
};

export function fleetSyncScope(props: Pick<SettingsProvidersTabProps, "fleetNodes" | "instances">) {
  const onlineNodes = props.fleetNodes.filter((node) => node.enabled !== false && node.status !== "offline");
  const nodeCount = Math.max(1, onlineNodes.length || props.fleetNodes.length);
  const agentCount = props.instances.length;
  return `${agentCount} agent${agentCount === 1 ? "" : "s"} · ${nodeCount} node${nodeCount === 1 ? "" : "s"}`;
}

export function providerDescription(selected?: ProviderCatalogItem) {
  if (!selected) return "Choose how agents connect to a model.";
  if (selected.id === "openai-codex") return "Uses Codex device login stored in Hermes auth.";
  if (selected.id === "ollama") return "Local Ollama usually needs no API key.";
  return selected.credentialKeys.length ? `Uses ${selected.credentialKeys.join(", ")}` : selected.description;
}

export function cleanEndpoint(value = "") {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function uniqueEndpoints(values: string[]) {
  return [...new Set(values.map(cleanEndpoint).filter(Boolean))].slice(0, CUSTOM_ENDPOINT_LIMIT);
}

export function providerEndpointList(provider: ProviderConfig) {
  return uniqueEndpoints([...(provider.customEndpoints || []), provider.provider === "custom" ? provider.baseUrl || "" : ""]);
}

export function providerUsesDeviceLogin(selected?: ProviderCatalogItem, providerId = "") {
  return Boolean(selected?.authType === "oauth_device_code" || selected?.id === "openai-codex" || providerId === "openai-codex");
}

export function providerOnboardingState(
  props: Pick<SettingsProvidersTabProps, "globalConfig" | "provider"> & { activeAgents: number },
  selected?: ProviderCatalogItem,
  providerDirty = false,
) {
  const providerId = selected?.id || props.provider.provider;
  const oauthCredential = props.globalConfig.oauthCredentials.find((item) => item.provider === providerId);
  const needsApiKey = Boolean(selected?.credentialKeys?.length);
  const savedCredentialKeys = new Set(props.globalConfig.credentials.map((credential) => credential.key));
  const hasRequiredApiKey = !needsApiKey || Boolean(selected?.credentialKeys.some((key) => savedCredentialKeys.has(key)));
  const authReady = providerUsesDeviceLogin(selected, props.provider.provider) ? Boolean(oauthCredential) : hasRequiredApiKey;
  return {
    activeAgents: props.activeAgents,
    authReady,
    hasProvider: Boolean(props.provider.provider && props.provider.model),
    needsApiKey,
    oauthCredential,
    providerId,
    providerLabel: selected?.label || (providerId === "openai-codex" ? "OpenAI Codex" : "Pick a provider preset"),
    providerDirty,
  };
}

export function activeProviderStep(authState: ReturnType<typeof providerOnboardingState>): 1 | 2 | 3 | 4 {
  if (!authState.hasProvider) return 1;
  if (!authState.authReady) return 2;
  if (authState.providerDirty) return 3;
  return 4;
}

export function credentialSetupState(props: Pick<SettingsProvidersTabProps, "globalConfig">, selected?: ProviderCatalogItem) {
  const apiKeyCount = props.globalConfig.credentials.length;
  const deviceLoginCount = props.globalConfig.oauthCredentials.length;
  const suggestedKey = selected?.credentialKeys?.[0] || "";
  const providerNeedsKey = Boolean(selected?.credentialKeys?.length);
  return {
    apiKeyCount,
    deviceLoginCount,
    hasAuth: apiKeyCount + deviceLoginCount > 0,
    providerNeedsKey,
    suggestedKey,
  };
}

export function formatCredentialAuthSummary(authState: ReturnType<typeof credentialSetupState>) {
  const parts = [];
  if (authState.apiKeyCount) parts.push(`${authState.apiKeyCount} API key${authState.apiKeyCount === 1 ? "" : "s"}`);
  if (authState.deviceLoginCount) parts.push(`${authState.deviceLoginCount} device login${authState.deviceLoginCount === 1 ? "" : "s"}`);
  return `${parts.join(" and ")} ${parts.length === 1 ? "is" : "are"} available to agents.`;
}

export function providerSignature(provider?: ProviderConfig | null) {
  if (!provider) return "";
  return JSON.stringify({
    provider: provider.provider || "",
    model: provider.model || "",
    baseUrl: cleanEndpoint(provider.baseUrl || ""),
    customEndpoints: providerEndpointList(provider),
  });
}

export function formatDate(value = "") {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function formatOauthError(error: unknown) {
  if (!error) return "Device login failed. Start a new login and try again.";
  if (typeof error === "string") return error;
  if (typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") return (error as { message: string }).message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function syncTargetKey(instance: Pick<Instance, "name" | "nodeId">) {
  return `${instance.nodeId || "local"}:${instance.name}`;
}
