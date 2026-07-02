import { FormEvent, memo, useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, GitPullRequest, Network, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { FleetNode } from "../models/fleet.ts";
import { LOCAL_FLEET_NODE } from "../models/fleet.ts";
import { deleteJson, postJson, putJson } from "../controllers/api.ts";
import { Alert } from "../components/ui/alert.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardForm, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Checkbox } from "../components/ui/checkbox.tsx";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "../components/ui/field.tsx";
import { Input } from "../components/ui/input.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { SettingsStep, SettingsStepper, useStepperExpansion } from "../components/ui/stepper.tsx";

type Draft = {
  id?: string;
  label: string;
  baseUrl: string;
  authToken: string;
  enabled: boolean;
};

const EMPTY_DRAFT: Draft = { label: "", baseUrl: "", authToken: "", enabled: true };

function fleetNodeOnboardingState(nodes: FleetNode[], draft: Draft, testResult: Record<string, string>) {
  let onlineCount = nodes.length ? 0 : 1;
  let remoteCount = 0;
  let testedRemoteCount = 0;
  for (const node of nodes) {
    if (node.status === "online") onlineCount += 1;
    if (!node.local) {
      remoteCount += 1;
      if (testResult[node.id]) testedRemoteCount += 1;
    }
  }
  const hasDraft = Boolean(draft.label.trim() || draft.baseUrl.trim() || draft.authToken.trim() || draft.id);

  return {
    hasDraft,
    onlineCount,
    remoteCount,
    testedRemoteCount,
  };
}

function consoleVersionLabel(node: FleetNode) {
  return node.console?.label || "Unknown";
}

function canForceConsoleUpdate(node: FleetNode) {
  return node.local || Boolean(node.console?.revision);
}

function fleetNodeBaseUrlError(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (!["http:", "https:"].includes(url.protocol)) return "Use an HTTP or HTTPS URL.";
    if (url.pathname.replace(/\/+$/, "").endsWith("/api")) return "Use the console origin, not the /api path.";
    return "";
  } catch {
    return "Enter a valid console URL.";
  }
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Unable to complete the request.";
}

export function SettingsFleetNodesTab({ nodes, onRefresh }: { nodes: FleetNode[]; onRefresh: () => Promise<void> }) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [busyAction, setBusyAction] = useState("");
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const remoteNodes = useMemo(() => nodes.filter((node) => !node.local), [nodes]);
  const configuredNodes = useMemo(() => nodes.length ? nodes : [LOCAL_FLEET_NODE], [nodes]);
  const editing = Boolean(draft.id);
  const onboarding = useMemo(() => fleetNodeOnboardingState(nodes, draft, testResult), [draft, nodes, testResult]);
  const baseUrlError = useMemo(() => fleetNodeBaseUrlError(draft.baseUrl), [draft.baseUrl]);
  const canSave = Boolean(draft.label.trim() && draft.baseUrl.trim() && !baseUrlError);

  useEffect(() => {
    if (editing && !remoteNodes.some((node) => node.id === draft.id)) setDraft(EMPTY_DRAFT);
  }, [draft.id, editing, remoteNodes]);

  const editNode = useCallback((node: FleetNode) => {
    setDraft({ id: node.id, label: node.label, baseUrl: node.baseUrl, authToken: "", enabled: node.enabled });
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusyAction("save");
    try {
      const body = { ...draft, authToken: draft.authToken || undefined };
      if (draft.id) await putJson(`/api/fleet/nodes/${encodeURIComponent(draft.id)}`, body);
      else await postJson("/api/fleet/nodes", body);
      setDraft(EMPTY_DRAFT);
      await onRefresh();
      toast.success(editing ? "Fleet node updated" : "Fleet node added");
    } finally {
      setBusyAction("");
    }
  }

  const remove = useCallback(async (node: FleetNode) => {
    setBusyAction(`delete:${node.id}`);
    try {
      await deleteJson(`/api/fleet/nodes/${encodeURIComponent(node.id)}`);
      await onRefresh();
      toast.success("Fleet node removed", { description: node.label });
    } finally {
      setBusyAction("");
    }
  }, [onRefresh]);

  const test = useCallback(async (node: FleetNode) => {
    setBusyAction(`test:${node.id}`);
    try {
      const data = await postJson<{ node: FleetNode }>(`/api/fleet/nodes/${encodeURIComponent(node.id)}/test`, {});
      setTestResult((current) => ({ ...current, [node.id]: data.node.status === "online" ? "Online" : data.node.error || "Offline" }));
      toast[data.node.status === "online" ? "success" : "error"](`${node.label} is ${data.node.status}`, { description: data.node.error || data.node.baseUrl });
    } finally {
      setBusyAction("");
    }
  }, []);

  const forceGitUpdate = useCallback(async (node: FleetNode) => {
    if (!canForceConsoleUpdate(node)) {
      toast.error("Console update endpoint unavailable", {
        description: "Update this remote Fleet Console manually once, then remote force update will be available.",
      });
      return;
    }
    const confirmed = window.confirm(`Force update and restart ${node.label}?\n\nThis will git fetch, hard reset that Fleet Console repo to its upstream branch, install dependencies, build, and restart the console.`);
    if (!confirmed) return;
    setBusyAction(`git:${node.id}`);
    try {
      const data = await postJson<{ logFile?: string; restart?: string }>(`/api/fleet/${encodeURIComponent(node.id)}/console/git-update-restart`, {});
      toast.success("Console update started", { description: `${node.label}${data.logFile ? ` · ${data.logFile}` : ""}` });
    } catch (error: unknown) {
      const message = errorMessage(error);
      toast.error("Console update failed", {
        description: message === "HTTP 404"
          ? "That Fleet Console does not have the remote update endpoint yet. Update it manually once, then try again."
          : message,
      });
    } finally {
      setBusyAction("");
    }
  }, []);

  const step1Complete = onboarding.onlineCount > 0;
  const step2Complete = onboarding.remoteCount > 0;
  const step3Reachable = step1Complete && step2Complete;
  const step3Complete = onboarding.testedRemoteCount > 0;
  const derivedActive = !step1Complete ? 1 : !step2Complete ? 2 : !step3Complete ? 3 : 4;
  const { activeStep, toggleStep } = useStepperExpansion(derivedActive);

  return (
    <Card className="settings-section settings-section-primary">
      <CardHeader className="settings-section-header">
        <div><CardTitle>Fleet nodes</CardTitle><CardDescription>Local Docker is included by default; add remote consoles from this network.</CardDescription></div>
        <Badge variant="secondary">1 local · {remoteNodes.length} remote</Badge>
      </CardHeader>
      <CardContent className="padded settings-section-content">
        <SettingsStepper>
          <SettingsStep
            index={1}
            title="Local node"
            active={activeStep === 1}
            complete={step1Complete}
            locked={false}
            summary={step1Complete ? `${onboarding.onlineCount} node${onboarding.onlineCount === 1 ? "" : "s"} online` : "Check status"}
            onToggle={() => toggleStep(1)}
          >
            <Alert variant="warning"><Network /><span>Only add Fleet Console instances you control on a trusted LAN, VPN, or tunnel. Tokens are redacted in the UI but stored in the local Fleet database.</span></Alert>
            <FleetNodeList busyAction={busyAction} nodes={configuredNodes} onEdit={editNode} onForceUpdate={forceGitUpdate} onRemove={remove} onTest={test} testResult={testResult} />
          </SettingsStep>
          <SettingsStep
            index={2}
            title="Add remote"
            active={activeStep === 2}
            complete={step2Complete}
            locked={!step1Complete}
            summary={step2Complete ? `${onboarding.remoteCount} remote node${onboarding.remoteCount === 1 ? "" : "s"} saved` : "Add a trusted remote console"}
            onToggle={() => toggleStep(2)}
          >
            <CardForm className="settings-node-form" onSubmit={save}>
              <FieldGroup className="settings-node-form-grid">
                <Field><FieldLabel htmlFor="fleet-node-label">Label</FieldLabel><Input id="fleet-node-label" value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} placeholder="Studio Mac" /></Field>
                <Field data-invalid={baseUrlError || undefined}><FieldLabel htmlFor="fleet-node-url">Base URL</FieldLabel><Input id="fleet-node-url" value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="http://192.168.1.42:5180" aria-invalid={Boolean(baseUrlError)} /><FieldDescription>{baseUrlError || "Use the remote console origin, not the /api path."}</FieldDescription></Field>
                <Field className="settings-node-token-field">
                  <FieldLabel htmlFor="fleet-node-token">Bearer token</FieldLabel>
                  <Input id="fleet-node-token" value={draft.authToken} onChange={(event) => setDraft({ ...draft, authToken: event.target.value })} placeholder={editing ? "Leave blank to keep current token" : "Recommended for remote nodes"} type="password" />
                  <FieldDescription>Remote consoles bound to the LAN should set HERMES_CONSOLE_TOKEN and use that token here.</FieldDescription>
                </Field>
                <label className="settings-node-enabled">
                  <Checkbox checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} aria-label="Enable fleet node" />
                  <span>Enabled</span>
                </label>
              </FieldGroup>
              <div className="settings-form-actions">
                {editing ? <Button variant="outline" type="button" onClick={() => setDraft(EMPTY_DRAFT)} disabled={Boolean(busyAction)}>Cancel edit</Button> : <span />}
                <Button disabled={Boolean(busyAction) || !canSave}>{busyAction === "save" ? <Spinner data-icon="inline-start" /> : editing ? <Save data-icon="inline-start" /> : <Plus data-icon="inline-start" />}{editing ? "Save node" : "Add node"}</Button>
              </div>
            </CardForm>
          </SettingsStep>
          <SettingsStep
            index={3}
            title="Test access"
            active={activeStep === 3}
            complete={step3Complete}
            locked={!step3Reachable}
            summary={step3Complete ? `${onboarding.testedRemoteCount} node${onboarding.testedRemoteCount === 1 ? "" : "s"} tested` : "Test remote nodes"}
            onToggle={() => toggleStep(3)}
          >
            <p className="settings-step-note">Run Test on each remote node to confirm it is reachable from this console.</p>
            <FleetNodeList busyAction={busyAction} nodes={remoteNodes} onEdit={editNode} onForceUpdate={forceGitUpdate} onRemove={remove} onTest={test} testResult={testResult} />
          </SettingsStep>
          <SettingsStep
            index={4}
            title="Operate fleet"
            active={activeStep === 4}
            complete={step3Complete}
            locked={!step3Complete}
            summary={step3Complete ? "All nodes included in dashboard" : "Complete testing first"}
            onToggle={() => toggleStep(4)}
          >
            <p className="settings-step-note">Tested remote nodes are included in the dashboard agent inventory. Manage agents from the Dashboard tab.</p>
            <FleetNodeList busyAction={busyAction} nodes={configuredNodes} onEdit={editNode} onForceUpdate={forceGitUpdate} onRemove={remove} onTest={test} testResult={testResult} />
          </SettingsStep>
        </SettingsStepper>
      </CardContent>
    </Card>
  );
}

const FleetNodeRow = memo(function FleetNodeRow({
  busyAction,
  node,
  onEdit,
  onForceUpdate,
  onRemove,
  onTest,
  testResult,
}: {
  busyAction: string;
  node: FleetNode;
  onEdit: (node: FleetNode) => void;
  onForceUpdate: (node: FleetNode) => void;
  onRemove: (node: FleetNode) => void;
  onTest: (node: FleetNode) => void;
  testResult?: string;
}) {
  const canForceUpdate = canForceConsoleUpdate(node);
  const busy = Boolean(busyAction);

  return (
    <div className="settings-node-row">
      <div>
        <strong>{node.label}</strong>
        <span>{node.local ? "This machine's Docker runtime" : node.baseUrl}</span>
        <small>
          {node.local ? "Built in" : node.enabled ? "Enabled" : "Disabled"}
          {` · Console ${consoleVersionLabel(node)}`}
          {node.local ? "" : ` · Token ${node.tokenConfigured ? node.redactedToken || "configured" : "not set"}`}
          {!node.local && !canForceUpdate ? " · Manual update needed" : ""}
          {testResult ? ` · ${testResult}` : ""}
        </small>
      </div>
      <span className={`fleet-status-cell ${node.status === "online" ? "good" : node.status === "offline" ? "warn" : "muted"}`}>
        <span className={`fleet-status-dot ${node.status === "online" ? "good" : node.status === "offline" ? "warn" : "muted"}`} aria-hidden="true" />
        {node.status || "unknown"}
      </span>
      <div className="settings-node-actions">
        <Button variant="outline" size="sm" type="button" onClick={() => onTest(node)} disabled={busy}>{busyAction === `test:${node.id}` ? <Spinner data-icon="inline-start" /> : <CheckCircle2 data-icon="inline-start" />}Test</Button>
        <Button variant="outline" size="sm" type="button" onClick={() => onForceUpdate(node)} disabled={busy || !canForceUpdate} title={canForceUpdate ? "Force git update and restart this console" : "Update this remote console manually once to enable remote force updates"}>{busyAction === `git:${node.id}` ? <Spinner data-icon="inline-start" /> : <GitPullRequest data-icon="inline-start" />}Force update</Button>
        <Button variant="outline" size="sm" type="button" onClick={() => onEdit(node)} disabled={busy || node.local}>{node.local ? "Default" : "Edit"}</Button>
        <Button variant="ghost" size="icon" type="button" aria-label={`Remove ${node.label}`} onClick={() => onRemove(node)} disabled={busy || node.local}>{busyAction === `delete:${node.id}` ? <Spinner data-icon="inline-start" /> : <Trash2 data-icon="inline-start" />}</Button>
      </div>
    </div>
  );
});

function FleetNodeList({ busyAction, nodes, onEdit, onForceUpdate, onRemove, onTest, testResult }: {
  busyAction: string;
  nodes: FleetNode[];
  onEdit: (node: FleetNode) => void;
  onForceUpdate: (node: FleetNode) => void;
  onRemove: (node: FleetNode) => void;
  onTest: (node: FleetNode) => void;
  testResult: Record<string, string>;
}) {
  return (
    <div className="settings-node-list">
      {nodes.map((node) => <FleetNodeRow busyAction={busyAction} key={node.id} node={node} onEdit={onEdit} onForceUpdate={onForceUpdate} onRemove={onRemove} onTest={onTest} testResult={testResult[node.id]} />)}
    </div>
  );
}
