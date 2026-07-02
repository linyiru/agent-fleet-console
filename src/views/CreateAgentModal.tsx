import QRCode from "qrcode";
import { CheckCircle2, Database, ExternalLink, Globe2, Library, MessageCircle, Monitor, Plus, QrCode, Server, Terminal, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Button } from "../components/ui/button.tsx";
import { DialogContent, DialogDescription, DialogHeader, DialogOverlay, DialogTitle } from "../components/ui/dialog.tsx";
import { Alert } from "../components/ui/alert.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { CardContent, CardFooter, CardForm } from "../components/ui/card.tsx";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "../components/ui/field.tsx";
import { Input } from "../components/ui/input.tsx";
import { Checkbox } from "../components/ui/checkbox.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { api, apiErrorMessage, postJson } from "../controllers/api.ts";
import type { AgentTemplateLibraryItem, CreateAgentOptions, FleetNode, GlobalConfig, ProviderConfig } from "../models/fleet.ts";
import { AGENT_NAME_PATTERN, LOCAL_FLEET_NODE, NEMOCLAW_AGENT_NAME_PATTERN, slugifyAgentName } from "../models/fleet.ts";

const TELEGRAM_USER_ID_PATTERN = /^[1-9]\d{4,19}$/;
const NEMOHERMES_OLLAMA_PROVIDER: ProviderConfig = {
  provider: "ollama",
  model: "qwen3:latest",
  baseUrl: "http://127.0.0.1:11434/v1",
  customEndpoints: [],
};

type TelegramSetup = {
  pairingId: string;
  deepLink: string;
  qrPayload: string;
  expiresAt: string;
};

type TelegramStatus = {
  status: "waiting" | "ready";
  botUsername?: string;
  bot_username?: string;
  ownerUserId?: string;
  owner_user_id?: string;
  expiresAt?: string;
  expires_at?: string;
};

export function CreateAgentModal({ open, onClose, onCreate, fleetNodes, globalConfig, onSaveProvider }: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, options: CreateAgentOptions) => Promise<void>;
  fleetNodes: FleetNode[];
  globalConfig: GlobalConfig;
  onSaveProvider: (provider: ProviderConfig) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [creationMode, setCreationMode] = useState<"fresh" | "template">("fresh");
  const [templates, setTemplates] = useState<AgentTemplateLibraryItem[]>([]);
  const [templateLibraryId, setTemplateLibraryId] = useState("");
  const [camofox, setCamofox] = useState(true);
  const [codexCli, setCodexCli] = useState(false);
  const [sharedMemory, setSharedMemory] = useState(false);
  const [runtime, setRuntime] = useState<CreateAgentOptions["runtime"]>("docker");
  const [nodeId, setNodeId] = useState("local");
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [telegramPhase, setTelegramPhase] = useState<"idle" | "starting" | "waiting" | "ready">("idle");
  const [telegramSetup, setTelegramSetup] = useState<TelegramSetup | null>(null);
  const [telegramQr, setTelegramQr] = useState("");
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramBotUsername, setTelegramBotUsername] = useState("");
  const [trustedTelegramId, setTrustedTelegramId] = useState("");
  const [telegramError, setTelegramError] = useState("");
  const [busy, setBusy] = useState(false);
  const [providerBusy, setProviderBusy] = useState(false);
  const [error, setError] = useState("");
  const deployableNodes = fleetNodes.length ? fleetNodes : [LOCAL_FLEET_NODE];
  const selectedNode = deployableNodes.find((node) => node.id === nodeId) || deployableNodes[0];
  const templateMode = creationMode === "template";
  const selectedTemplate = templates.find((template) => template.id === templateLibraryId) || null;
  const effectiveRuntime = templateMode ? "docker" : runtime;
  const trimmed = slugifyAgentName(name, { allowUnderscore: effectiveRuntime !== "nemoclaw" });
  const valid = (effectiveRuntime === "nemoclaw" ? NEMOCLAW_AGENT_NAME_PATTERN : AGENT_NAME_PATTERN).test(trimmed);
  const targetReady = Boolean(selectedNode && selectedNode.enabled !== false && selectedNode.status !== "offline");
  const templateReady = !templateMode || Boolean(selectedTemplate);
  const telegramReady = templateMode || !telegramEnabled || (telegramPhase === "ready" && Boolean(telegramBotToken) && TELEGRAM_USER_ID_PATTERN.test(trustedTelegramId.trim()));
  const telegramIdInvalid = !templateMode && telegramEnabled && trustedTelegramId.trim() !== "" && !TELEGRAM_USER_ID_PATTERN.test(trustedTelegramId.trim());
  const credentials = globalConfig?.credentials || [];
  const credentialKeys = useMemo(() => new Set(credentials.map((credential) => credential.key)), [credentials]);
  const providerId = globalConfig?.provider?.provider || "";
  const providerBaseUrl = globalConfig?.provider?.baseUrl || "";
  const selectedNodeIsLocal = selectedNode.id === "local" || selectedNode.local === true;
  const codexLoginSaved = Boolean(globalConfig?.oauthCredentials?.some((credential) => credential.provider === "openai-codex"));
  const codexCliDisabled = runtime === "nemoclaw" || (selectedNodeIsLocal && !codexLoginSaved);
  const codexCliDescription = runtime === "nemoclaw"
    ? "Available for Docker Hermes agents."
    : selectedNodeIsLocal && !codexLoginSaved
      ? "Complete Codex device login in Settings first."
      : selectedNodeIsLocal
        ? "Install Codex CLI and reuse Fleet's saved device login."
        : "Install Codex CLI using the target node's saved Codex login.";
  const nemoHermesProviderIssue = !templateMode && runtime === "nemoclaw"
    ? nemoHermesProviderMessage(providerId, providerBaseUrl, credentialKeys)
    : "";
  const nemoHermesBlocked = Boolean(nemoHermesProviderIssue);
  const nameHelp = effectiveRuntime === "nemoclaw"
    ? "NemoHermes sandbox names use lowercase letters, numbers, and hyphens. Up to 63 characters."
    : "Lowercase letters, numbers, hyphens, and underscores. Up to 63 characters.";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || !targetReady || !telegramReady || !templateReady || nemoHermesBlocked) return;
    setBusy(true);
    setError("");
    try {
      const capabilities = {
        ...(codexCli && runtime === "docker" ? { codexCli: true } : {}),
        ...(sharedMemory && runtime === "docker" ? { sharedMemory: true } : {}),
      };
      await onCreate(trimmed, {
        camofox: templateMode ? true : camofox,
        runtime: templateMode ? "docker" : runtime,
        nodeId: selectedNode.id,
        templateLibraryId: templateMode ? templateLibraryId : undefined,
        capabilities: templateMode ? {} : capabilities,
        telegram: !templateMode && telegramEnabled ? {
          enabled: true,
          botToken: telegramBotToken,
          botUsername: telegramBotUsername,
          trustedUserId: trustedTelegramId.trim(),
          allowedUserIds: [trustedTelegramId.trim()],
          homeChannel: trustedTelegramId.trim(),
        } : { enabled: false },
      });
      setName("");
      setCreationMode("fresh");
      setTemplateLibraryId("");
      setCodexCli(false);
      setSharedMemory(false);
      resetTelegram();
    } catch (err: any) {
      setError(apiErrorMessage(err, "Could not create agent"));
    } finally {
      setBusy(false);
    }
  }

  async function useOllamaForNemoHermes() {
    if (providerBusy) return;
    setProviderBusy(true);
    setError("");
    try {
      await onSaveProvider(NEMOHERMES_OLLAMA_PROVIDER);
    } catch (err) {
      setError(apiErrorMessage(err, "Could not switch Fleet provider to Ollama"));
    } finally {
      setProviderBusy(false);
    }
  }

  function resetTelegram() {
    setTelegramPhase("idle");
    setTelegramSetup(null);
    setTelegramQr("");
    setTelegramBotToken("");
    setTelegramBotUsername("");
    setTrustedTelegramId("");
    setTelegramError("");
  }

  async function startTelegramSetup() {
    if (!targetReady || telegramPhase === "starting" || telegramPhase === "waiting") return;
    setTelegramPhase("starting");
    setTelegramError("");
    setTelegramBotToken("");
    setTelegramBotUsername("");
    try {
      const setup = await postJson<any>(`/api/fleet/${encodeURIComponent(selectedNode.id)}/telegram/onboarding/start`, {
        botName: trimmed ? `${trimmed} Hermes` : "Hermes Agent",
      });
      const normalized = {
        pairingId: setup.pairingId || setup.pairing_id,
        deepLink: setup.deepLink || setup.deep_link,
        qrPayload: setup.qrPayload || setup.qr_payload,
        expiresAt: setup.expiresAt || setup.expires_at,
      };
      const qr = await QRCode.toDataURL(normalized.qrPayload, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 224,
      });
      setTelegramSetup(normalized);
      setTelegramQr(qr);
      setTelegramPhase("waiting");
    } catch (err: any) {
      setTelegramPhase("idle");
      setTelegramError(err.message || String(err));
    }
  }

  async function cancelTelegramSetup() {
    if (telegramSetup) {
      await api(`/api/fleet/${encodeURIComponent(selectedNode.id)}/telegram/onboarding/${encodeURIComponent(telegramSetup.pairingId)}`, { method: "DELETE" }).catch(() => null);
    }
    resetTelegram();
  }

  useEffect(() => {
    if (!telegramEnabled || telegramPhase !== "waiting" || !telegramSetup) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const status = await api<TelegramStatus>(`/api/fleet/${encodeURIComponent(selectedNode.id)}/telegram/onboarding/${encodeURIComponent(telegramSetup.pairingId)}`);
        if (cancelled) return;
        if (status.status === "ready") {
          const ownerId = status.ownerUserId || status.owner_user_id || "";
          setTelegramBotUsername(status.botUsername || status.bot_username || "");
          setTelegramPhase("ready");
          setTelegramError("");
          if (ownerId && TELEGRAM_USER_ID_PATTERN.test(ownerId)) setTrustedTelegramId(ownerId);
          const tokenStatus = status as TelegramStatus & { botToken?: string; bot_token?: string };
          setTelegramBotToken(tokenStatus.botToken || tokenStatus.bot_token || "");
          return;
        }
        timer = window.setTimeout(poll, 2000);
      } catch (err: any) {
        if (cancelled) return;
        setTelegramError(err.message || String(err));
        timer = window.setTimeout(poll, 2500);
      }
    };
    timer = window.setTimeout(poll, 1200);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [selectedNode.id, telegramEnabled, telegramPhase, telegramSetup]);

  useEffect(() => {
    if (!open) return;
    api<{ templates: AgentTemplateLibraryItem[] }>("/api/template-library")
      .then((data) => {
        setTemplates(data.templates || []);
        if (!templateLibraryId && data.templates?.[0]?.id) setTemplateLibraryId(data.templates[0].id);
      })
      .catch(() => setTemplates([]));
  }, [open]);

  const telegramExpiry = useMemo(() => {
    if (!telegramSetup?.expiresAt) return "";
    const ms = Date.parse(telegramSetup.expiresAt) - Date.now();
    if (!Number.isFinite(ms)) return "";
    if (ms <= 0) return "expired";
    const minutes = Math.ceil(ms / 60000);
    return `${minutes}m left`;
  }, [telegramSetup]);

  useEffect(() => {
    if (!open) resetTelegram();
  }, [open]);

  useEffect(() => {
    if (codexCliDisabled) setCodexCli(false);
  }, [codexCliDisabled]);

  useEffect(() => {
    if (creationMode !== "template") return;
    setRuntime("docker");
    setCodexCli(false);
    setSharedMemory(false);
    setTelegramEnabled(false);
    resetTelegram();
    if (!templateLibraryId && templates[0]?.id) setTemplateLibraryId(templates[0].id);
  }, [creationMode, templates, templateLibraryId]);

  if (!open) return null;

  return (
    <DialogOverlay onClick={onClose}>
      <DialogContent className="create-agent-modal" onClick={(event) => event.stopPropagation()}>
        <DialogHeader>
          <div><DialogTitle>New agent</DialogTitle><DialogDescription>Create a managed agent for this fleet.</DialogDescription></div>
          <Button variant="outline" size="icon" aria-label="Close create agent" onClick={onClose}><X data-icon="inline-start" /></Button>
        </DialogHeader>
        <CardForm className="create-agent-form" onSubmit={submit}>
          <CardContent className="padded create-agent-content">
            <FieldGroup>
              <Field>
                <FieldLabel>Creation source</FieldLabel>
                <label className={`create-agent-option ${creationMode === "fresh" ? "selected" : ""}`}>
                  <Plus />
                  <span className="create-agent-option-copy"><strong>Fresh agent</strong><small>Start from the standard Hermes baseline.</small></span>
                  <Checkbox checked={creationMode === "fresh"} onChange={() => setCreationMode("fresh")} aria-label="Create a fresh agent" />
                </label>
                <label className={`create-agent-option ${templateMode ? "selected" : ""} ${templates.length ? "" : "disabled"}`}>
                  <Library />
                  <span className="create-agent-option-copy"><strong>From template</strong><small>Redeploy a saved secret-free agent template.</small></span>
                  <Checkbox checked={templateMode} disabled={!templates.length} onChange={() => setCreationMode("template")} aria-label="Create from template" />
                </label>
              </Field>
              <Field>
                <FieldLabel htmlFor="agent-node">Deploy on</FieldLabel>
                <Select value={selectedNode.id} onValueChange={(value) => { setNodeId(value); resetTelegram(); }}>
                  <SelectTrigger id="agent-node" className="w-full"><SelectValue placeholder="Select machine" /></SelectTrigger>
                  <SelectContent>
                    {deployableNodes.map((node) => {
                      const unavailable = node.enabled === false || node.status === "offline";
                      const label = `${node.label}${node.local ? " (local)" : ""}${unavailable ? " unavailable" : ""}`;
                      return <SelectItem key={node.id} value={node.id} disabled={unavailable}>{label}</SelectItem>;
                    })}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {selectedNode.local ? "Creates the agent on this machine." : `Creates the agent on ${selectedNode.label}${selectedNode.status ? ` (${selectedNode.status})` : ""}.`}
                </FieldDescription>
              </Field>
              <Field data-invalid={Boolean(name && !valid) || undefined}>
                <FieldLabel htmlFor="agent-name">Agent name</FieldLabel>
                <Input id="agent-name" value={name} onChange={(event) => { setName(event.target.value); setError(""); }} placeholder="research-agent" autoFocus aria-invalid={Boolean(name && !valid)} />
                <FieldDescription>{name && !valid ? `Use ${trimmed.replace(/_/g, "-") || "agent-name"}.` : nameHelp}</FieldDescription>
              </Field>
              {templateMode ? (
                <Field>
                  <FieldLabel>Template</FieldLabel>
                  <Select value={templateLibraryId} onValueChange={setTemplateLibraryId}>
                    <SelectTrigger><SelectValue placeholder="Select template" /></SelectTrigger>
                    <SelectContent>{templates.map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <FieldDescription>{selectedTemplate ? `Captured from ${selectedTemplate.sourceInstance}.` : "Save a template in Settings first."}</FieldDescription>
                </Field>
              ) : null}
              {!templateMode ? <Field>
                <FieldLabel>Runtime</FieldLabel>
                <label className={`create-agent-option ${runtime === "docker" ? "selected" : ""}`}>
                  <Server />
                  <span className="create-agent-option-copy"><strong>Docker Hermes</strong><small>Run with the console-managed Hermes Docker baseline.</small></span>
                  <Checkbox checked={runtime === "docker"} onChange={() => setRuntime("docker")} aria-label="Use Docker Hermes runtime" />
                </label>
                <label className={`create-agent-option ${runtime === "nemoclaw" ? "selected" : ""}`}>
                  <Server />
                  <span className="create-agent-option-copy"><strong>NemoHermes</strong><small>Create a Hermes OpenShell sandbox with the nemohermes runner.</small></span>
                  <Checkbox checked={runtime === "nemoclaw"} onChange={() => { setRuntime("nemoclaw"); setCamofox(false); setCodexCli(false); setSharedMemory(false); }} aria-label="Use NemoHermes runtime" />
                </label>
                {runtime === "nemoclaw" ? (
                  <>
                    {nemoHermesBlocked ? (
                      <Alert variant="warning" className="create-agent-provider-alert">
                        <span>{nemoHermesProviderIssue}</span>
                        <Button type="button" variant="outline" size="sm" onClick={() => void useOllamaForNemoHermes()} disabled={providerBusy || busy}>
                          {providerBusy ? <Spinner data-icon="inline-start" /> : <Server data-icon="inline-start" />}
                          Use Ollama
                        </Button>
                      </Alert>
                    ) : null}
                    <Alert variant="warning">If NemoHermes is missing on {selectedNode.local ? "this machine" : selectedNode.label}, Fleet will install it before creating the sandbox.</Alert>
                  </>
                ) : null}
              </Field> : null}
              {!templateMode ? <Field>
                <FieldLabel>Capabilities</FieldLabel>
                <div className="create-agent-option create-agent-option-static">
                  <Globe2 />
                  <span className="create-agent-option-copy"><strong>Webhost</strong><small>Publish static pages and SPAs from workspace/web with a local and LAN URL.</small></span>
                  <Badge variant="secondary">Included</Badge>
                </div>
                <label className={`create-agent-option ${camofox ? "selected" : ""} ${runtime === "nemoclaw" ? "disabled" : ""}`}>
                  <Monitor />
                  <span className="create-agent-option-copy"><strong>Browser runtime</strong><small>Include Camofox automation and a visual desktop endpoint.</small></span>
                  <Checkbox checked={camofox} disabled={runtime === "nemoclaw"} onChange={(event) => setCamofox(event.target.checked)} aria-label="Include browser and VNC" />
                </label>
                <label className={`create-agent-option ${codexCli ? "selected" : ""} ${codexCliDisabled ? "disabled" : ""}`}>
                  <Terminal />
                  <span className="create-agent-option-copy"><strong>Codex CLI</strong><small>{codexCliDescription}</small></span>
                  <Checkbox checked={codexCli} disabled={codexCliDisabled} onChange={(event) => setCodexCli(event.target.checked)} aria-label="Install Codex CLI" />
                </label>
                <label className={`create-agent-option ${sharedMemory ? "selected" : ""} ${runtime === "nemoclaw" ? "disabled" : ""}`}>
                  <Database />
                  <span className="create-agent-option-copy"><strong>Shared memory</strong><small>Link this agent to Fleet shared memory during creation.</small></span>
                  <Checkbox checked={sharedMemory} disabled={runtime === "nemoclaw"} onChange={(event) => setSharedMemory(event.target.checked)} aria-label="Link agent to shared memory" />
                </label>
              </Field> : null}
              {!templateMode ? <Field data-invalid={telegramIdInvalid || undefined}>
                <FieldLabel>Telegram</FieldLabel>
                <label className={`create-agent-option ${telegramEnabled ? "selected" : ""}`}>
                  <MessageCircle />
                  <span className="create-agent-option-copy"><strong>Telegram bot</strong><small>Create a bot with the Hermes QR pairing flow and restrict it to a trusted account.</small></span>
                  <Checkbox checked={telegramEnabled} onChange={(event) => { setTelegramEnabled(event.target.checked); if (!event.target.checked) void cancelTelegramSetup(); }} aria-label="Set up Telegram bot" />
                </label>
                {telegramEnabled ? (
                  <div className="telegram-create-panel">
                    <div className="telegram-create-actions">
                      <Button variant="outline" type="button" onClick={() => void startTelegramSetup()} disabled={!targetReady || telegramPhase === "starting" || telegramPhase === "waiting" || busy}>
                        {telegramPhase === "starting" ? <Spinner data-icon="inline-start" /> : <QrCode data-icon="inline-start" />}
                        {telegramPhase === "ready" ? "Restart QR setup" : telegramPhase === "waiting" ? "Waiting for Telegram" : "Generate QR"}
                      </Button>
                      {telegramPhase === "ready" ? <Badge variant="success"><CheckCircle2 data-icon="inline-start" />Bot ready</Badge> : null}
                      {telegramSetup && telegramExpiry ? <Badge variant="secondary">{telegramExpiry}</Badge> : null}
                    </div>
                    {telegramQr ? (
                      <div className="telegram-create-qr">
                        <img src={telegramQr} alt="Telegram setup QR code" />
                        <div className="telegram-create-qr-copy">
                          <strong>{telegramPhase === "ready" ? "Telegram confirmed" : "Scan to create the bot"}</strong>
                          <small>{telegramBotUsername ? `@${telegramBotUsername}` : "Tap Create Bot in Telegram after scanning."}</small>
                          <a href={telegramSetup?.deepLink || "#"} target="_blank" rel="noreferrer"><ExternalLink data-icon="inline-start" />Open Telegram</a>
                        </div>
                      </div>
                    ) : null}
                    {telegramPhase === "ready" ? (
                      <Field>
                        <FieldLabel htmlFor="trusted-telegram-id">Trusted Telegram account ID</FieldLabel>
                        <Input id="trusted-telegram-id" value={trustedTelegramId} onChange={(event) => { setTrustedTelegramId(event.target.value); setTelegramError(""); }} placeholder="123456789" inputMode="numeric" aria-invalid={telegramIdInvalid} />
                        <FieldDescription>{telegramIdInvalid ? "Use your numeric Telegram user ID." : "This ID is saved as TELEGRAM_ALLOWED_USERS and TELEGRAM_HOME_CHANNEL."}</FieldDescription>
                      </Field>
                    ) : null}
                    {telegramError ? <Alert variant="warning">{telegramError}</Alert> : null}
                  </div>
                ) : null}
              </Field> : null}
            </FieldGroup>
            {!targetReady ? <Alert variant="warning">Select an online machine before creating an agent.</Alert> : null}
            {templateMode && !templateReady ? <Alert variant="warning">Select a saved template before creating this agent.</Alert> : null}
            {telegramEnabled && !telegramReady ? <Alert variant="warning">Complete Telegram QR setup and enter a trusted account ID before creating this agent.</Alert> : null}
            {error ? <Alert variant="warning">{error}</Alert> : null}
          </CardContent>
          <CardFooter className="create-agent-footer">
            <Button variant="outline" type="button" onClick={onClose} disabled={busy || providerBusy}>Cancel</Button>
            <Button disabled={!valid || !targetReady || !telegramReady || !templateReady || nemoHermesBlocked || busy || providerBusy}>
              {busy ? <Spinner data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
              Create agent
            </Button>
          </CardFooter>
        </CardForm>
      </DialogContent>
    </DialogOverlay>
  );
}

function nemoHermesProviderMessage(providerId: string, baseUrl: string, credentialKeys: Set<string>) {
  if (providerId === "ollama") return "";
  if (providerId === "openrouter") {
    return credentialKeys.has("OPENROUTER_API_KEY")
      ? ""
      : "NemoHermes needs an API-key provider. Add OPENROUTER_API_KEY for OpenRouter, or switch this create flow to local Ollama.";
  }
  if (providerId === "custom") {
    if (!baseUrl) return "NemoHermes needs a custom provider base URL, or switch this create flow to local Ollama.";
    return credentialKeys.has("COMPATIBLE_API_KEY") || credentialKeys.has("OPENAI_API_KEY")
      ? ""
      : "NemoHermes needs COMPATIBLE_API_KEY or OPENAI_API_KEY for this custom endpoint, or switch this create flow to local Ollama.";
  }
  if (providerId === "openai-codex") {
    return "NemoHermes cannot use the OpenAI Codex device-login provider. Switch this create flow to local Ollama or choose an API-key provider in Settings.";
  }
  return "NemoHermes needs Fleet Settings set to Ollama, OpenRouter, or a custom OpenAI-compatible endpoint.";
}
