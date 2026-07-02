import { FilePlus2, Library, Rocket, Trash2, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { AgentTemplateLibraryItem, FleetNode, Instance, Job, TemplateRequirementCheck } from "../models/fleet.ts";
import { LOCAL_FLEET_NODE, slugifyAgentName } from "../models/fleet.ts";
import { api, apiErrorMessage, deleteJson, postJson } from "../controllers/api.ts";
import { Alert } from "../components/ui/alert.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardFooter, CardForm, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Checkbox } from "../components/ui/checkbox.tsx";
import { DialogContent, DialogDescription, DialogHeader, DialogOverlay, DialogTitle } from "../components/ui/dialog.tsx";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "../components/ui/field.tsx";
import { Input, Textarea } from "../components/ui/input.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { Table, TableBody, TableCell, TableRow } from "../components/ui/table.tsx";
import { toast } from "sonner";

type TemplateList = { templates: AgentTemplateLibraryItem[] };

function fallbackNodes(nodes: FleetNode[]) {
  return nodes.length ? nodes : [LOCAL_FLEET_NODE];
}

function formatSize(size = 0) {
  if (!Number.isFinite(size) || size <= 0) return "Unknown size";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function defaultDeployName(template: AgentTemplateLibraryItem) {
  const base = slugifyAgentName(template.sourceInstance || template.id || "agent");
  return `${base}-copy`;
}

export function TemplateLibraryPanel({ instances, fleetNodes, onRefreshFleet }: {
  instances: Instance[];
  fleetNodes: FleetNode[];
  onRefreshFleet: () => Promise<void>;
}) {
  const [templates, setTemplates] = useState<AgentTemplateLibraryItem[]>([]);
  const [sourceName, setSourceName] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [includeWorkspace, setIncludeWorkspace] = useState(true);
  const [busyAction, setBusyAction] = useState("");
  const [deploying, setDeploying] = useState<AgentTemplateLibraryItem | null>(null);
  const sourceAgents = useMemo(() => instances.filter((instance) => instance.runtime !== "nemoclaw" && instance.nodeLocal !== false && !instance.pendingCreate), [instances]);

  const loadTemplates = useCallback(async () => {
    const data = await api<TemplateList>("/api/template-library");
    setTemplates(data.templates || []);
  }, []);

  useEffect(() => { loadTemplates().catch(() => undefined); }, [loadTemplates]);
  useEffect(() => {
    if (!sourceName && sourceAgents[0]?.name) setSourceName(sourceAgents[0].name);
  }, [sourceAgents, sourceName]);

  async function captureTemplate(event: FormEvent) {
    event.preventDefault();
    if (!sourceName || !name.trim()) return;
    setBusyAction("capture");
    try {
      await postJson("/api/template-library/capture", {
        sourceName,
        name: name.trim(),
        description: description.trim(),
        includeWorkspace,
      });
      setName("");
      setDescription("");
      toast.success("Template saved", { description: sourceName });
      await loadTemplates();
    } catch (error) {
      toast.error("Could not save template", { description: apiErrorMessage(error) });
    } finally {
      setBusyAction("");
    }
  }

  async function deleteTemplate(template: AgentTemplateLibraryItem) {
    setBusyAction(`delete:${template.id}`);
    try {
      await deleteJson(`/api/template-library/${encodeURIComponent(template.id)}`);
      toast.success("Template deleted", { description: template.name });
      await loadTemplates();
    } finally {
      setBusyAction("");
    }
  }

  return (
    <div className="template-library-layout">
      <Card className="settings-section settings-section-primary">
        <CardHeader className="settings-section-header">
          <div><CardTitle>Template library</CardTitle><CardDescription>Reusable secret-free Docker agent templates.</CardDescription></div>
          <Badge variant="secondary">{templates.length} template{templates.length === 1 ? "" : "s"}</Badge>
        </CardHeader>
        <CardContent className="padded settings-section-content">
          <CardForm className="template-capture-form" onSubmit={captureTemplate}>
            <FieldGroup className="field-grid two">
              <Field>
                <FieldLabel>Source agent</FieldLabel>
                <Select value={sourceName} onValueChange={setSourceName}>
                  <SelectTrigger><SelectValue placeholder="Select agent" /></SelectTrigger>
                  <SelectContent>{sourceAgents.map((agent) => <SelectItem key={agent.name} value={agent.name}>{agent.displayName || agent.name}</SelectItem>)}</SelectContent>
                </Select>
                <FieldDescription>Local Docker Hermes agents can be captured.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="template-library-name">Template name</FieldLabel>
                <Input id="template-library-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ops assistant baseline" />
              </Field>
            </FieldGroup>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="template-library-description">Description</FieldLabel>
                <Textarea id="template-library-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
              </Field>
              <label className="backup-option"><Checkbox checked={includeWorkspace} onChange={(event) => setIncludeWorkspace(event.target.checked)} /><span><strong>Workspace</strong><small>Include project files, excluding generated folders.</small></span></label>
            </FieldGroup>
            {!sourceAgents.length ? <Alert variant="warning">Create a local Docker Hermes agent before saving templates.</Alert> : null}
            <CardFooter className="backup-panel-footer">
              <Button disabled={busyAction === "capture" || !sourceName || !name.trim()}>
                {busyAction === "capture" ? <Spinner data-icon="inline-start" /> : <FilePlus2 data-icon="inline-start" />}
                Save template
              </Button>
            </CardFooter>
          </CardForm>
          <TemplateTable templates={templates} busyAction={busyAction} onDeploy={setDeploying} onDelete={(template) => void deleteTemplate(template)} />
        </CardContent>
      </Card>
      {deploying ? (
        <TemplateDeployModal
          template={deploying}
          fleetNodes={fallbackNodes(fleetNodes)}
          onClose={() => setDeploying(null)}
          onDone={async () => {
            setDeploying(null);
            await onRefreshFleet();
          }}
        />
      ) : null}
    </div>
  );
}

function TemplateTable({ templates, busyAction, onDeploy, onDelete }: {
  templates: AgentTemplateLibraryItem[];
  busyAction: string;
  onDeploy: (template: AgentTemplateLibraryItem) => void;
  onDelete: (template: AgentTemplateLibraryItem) => void;
}) {
  if (!templates.length) {
    return (
      <div className="backup-empty">
        <Library />
        <div>
          <strong>No templates yet</strong>
          <span>Save a configured Docker agent as a reusable template.</span>
        </div>
      </div>
    );
  }
  return (
    <Table className="backup-table">
      <TableBody>{templates.map((template) => (
        <TableRow key={template.id}>
          <TableCell>
            <div className="backup-file-cell">
              <strong>{template.name}</strong>
              <span>{template.sourceInstance} · {formatSize(template.archive.size)}</span>
            </div>
          </TableCell>
          <TableCell className="ui-table-actions">
            <Button variant="outline" size="sm" onClick={() => onDeploy(template)}><Rocket data-icon="inline-start" />Deploy</Button>
            <Button variant="ghost" size="sm" disabled={busyAction === `delete:${template.id}`} onClick={() => onDelete(template)}>
              {busyAction === `delete:${template.id}` ? <Spinner data-icon="inline-start" /> : <Trash2 data-icon="inline-start" />}
              Delete
            </Button>
          </TableCell>
        </TableRow>
      ))}</TableBody>
    </Table>
  );
}

function TemplateDeployModal({ template, fleetNodes, onClose, onDone }: {
  template: AgentTemplateLibraryItem;
  fleetNodes: FleetNode[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [targetNodeId, setTargetNodeId] = useState(fleetNodes[0]?.id || "local");
  const [name, setName] = useState(defaultDeployName(template));
  const [start, setStart] = useState(true);
  const [allowMissingRequirements, setAllowMissingRequirements] = useState(false);
  const [check, setCheck] = useState<TemplateRequirementCheck | null>(null);
  const [busy, setBusy] = useState("");
  const selectedNode = fleetNodes.find((node) => node.id === targetNodeId) || fleetNodes[0];
  const targetReady = Boolean(selectedNode && selectedNode.enabled !== false && selectedNode.status !== "offline");
  const missing = check?.missing || [];
  const canDeploy = Boolean(name.trim() && targetReady && (!missing.length || allowMissingRequirements) && !busy);

  const checkRequirements = useCallback(async () => {
    setBusy("check");
    try {
      setCheck(await postJson<TemplateRequirementCheck>(`/api/template-library/${encodeURIComponent(template.id)}/requirements/check`, { targetNodeId }));
    } finally {
      setBusy("");
    }
  }, [targetNodeId, template.id]);

  useEffect(() => { checkRequirements().catch(() => undefined); }, [checkRequirements]);

  async function deploy(event: FormEvent) {
    event.preventDefault();
    if (!canDeploy) return;
    setBusy("deploy");
    try {
      const { job } = await postJson<{ job: Job }>(`/api/template-library/${encodeURIComponent(template.id)}/deploy`, {
        targetNodeId,
        name: name.trim(),
        start,
        allowMissingRequirements,
      });
      toast.success("Template deploy queued", { description: `Job #${job.id} on ${selectedNode?.label || targetNodeId}` });
      await onDone();
    } catch (error) {
      toast.error("Could not deploy template", { description: apiErrorMessage(error) });
    } finally {
      setBusy("");
    }
  }

  return (
    <DialogOverlay onClick={onClose}>
      <DialogContent className="create-agent-modal" onClick={(event) => event.stopPropagation()}>
        <DialogHeader>
          <div><DialogTitle>Deploy {template.name}</DialogTitle><DialogDescription>Create a new Docker agent from this template.</DialogDescription></div>
          <Button variant="outline" size="icon" aria-label="Close template deploy" onClick={onClose}><X data-icon="inline-start" /></Button>
        </DialogHeader>
        <CardForm onSubmit={deploy}>
          <CardContent className="padded">
            <FieldGroup>
              <Field>
                <FieldLabel>Deploy on</FieldLabel>
                <Select value={targetNodeId} onValueChange={(value) => { setTargetNodeId(value); setCheck(null); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{fleetNodes.map((node) => <SelectItem key={node.id} value={node.id} disabled={node.enabled === false || node.status === "offline"}>{node.label}{node.local ? " (local)" : ""}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="template-deploy-name">Agent name</FieldLabel>
                <Input id="template-deploy-name" value={name} onChange={(event) => setName(event.target.value)} />
              </Field>
              <label className="backup-option"><Checkbox checked={start} onChange={(event) => setStart(event.target.checked)} /><span><strong>Start agent</strong><small>Bring services online after deploy.</small></span></label>
            </FieldGroup>
            {!targetReady ? <Alert variant="warning">Select an online target node.</Alert> : null}
            {missing.length ? (
              <Alert variant="warning">
                <strong>Missing requirements</strong>
                <span>{missing.map((item) => item.label).join(", ")}</span>
              </Alert>
            ) : null}
            {missing.length ? <label className="backup-option warning"><Checkbox checked={allowMissingRequirements} onChange={(event) => setAllowMissingRequirements(event.target.checked)} /><span><strong>Deploy anyway</strong><small>Missing auth or credentials can be added after deploy.</small></span></label> : null}
          </CardContent>
          <CardFooter className="create-agent-footer">
            <Button variant="outline" type="button" onClick={onClose} disabled={Boolean(busy)}>Cancel</Button>
            <Button disabled={!canDeploy}>
              {busy === "deploy" ? <Spinner data-icon="inline-start" /> : <Rocket data-icon="inline-start" />}
              Deploy template
            </Button>
          </CardFooter>
        </CardForm>
      </DialogContent>
    </DialogOverlay>
  );
}
