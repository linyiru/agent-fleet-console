import { Archive, CircleAlert, CircleStop, Clock, CopyPlus, Download, Library, MoveRight, Play, RotateCw, Trash2, type LucideIcon } from "lucide-react";
import { useState } from "react";
import type { AgentBackupOptions, AgentCloneOptions, AgentMoveOptions, AgentTemplateCaptureOptions, FleetNode, Instance, Job } from "../models/fleet.ts";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Progress } from "../components/ui/progress.tsx";
import { Separator } from "../components/ui/separator.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { DetailRow } from "./AgentDetailRows.tsx";
import { AgentBackupModal } from "./AgentBackupModal.tsx";
import { AgentCloneModal } from "./AgentCloneModal.tsx";
import { AgentMoveModal } from "./AgentMoveModal.tsx";
import { AgentTemplateCaptureModal } from "./AgentTemplateCaptureModal.tsx";

type LifecycleAction = "start" | "stop" | "restart" | "update" | "delete";
type ConfirmableLifecycleAction = Exclude<LifecycleAction, "start">;

const LIFECYCLE_CONFIRMATION_COPY: Record<ConfirmableLifecycleAction, { title: string; description: string; actionLabel: string; variant?: "default" | "destructive" }> = {
  stop: { title: "Stop this agent?", description: "This will stop the agent container and interrupt active services until it is started again.", actionLabel: "Stop agent", variant: "destructive" },
  restart: { title: "Restart this agent?", description: "This will briefly take the agent offline while its services restart.", actionLabel: "Restart agent" },
  update: { title: "Update this agent?", description: "This will run the agent update workflow. The agent may be unavailable while the update completes.", actionLabel: "Update agent" },
  delete: { title: "Delete this agent?", description: "This permanently removes the agent from the fleet. This action cannot be undone.", actionLabel: "Delete agent", variant: "destructive" },
};

export function LifecyclePanel({ selected, jobs, instances, fleetNodes, pendingAction, onBackupAgent, onCaptureTemplate, onCloneAgent, onMoveAgent, runAction }: {
  selected: Instance;
  jobs: Job[];
  instances: Instance[];
  fleetNodes: FleetNode[];
  pendingAction: string;
  onBackupAgent: (name: string, options: AgentBackupOptions) => Promise<void>;
  onCaptureTemplate: (name: string, options: AgentTemplateCaptureOptions) => Promise<void>;
  onCloneAgent: (name: string, options: AgentCloneOptions) => Promise<void>;
  onMoveAgent: (name: string, options: AgentMoveOptions) => Promise<void>;
  runAction: (action: string) => Promise<void>;
}) {
  const [confirmAction, setConfirmAction] = useState<ConfirmableLifecycleAction | null>(null);
  const [backupOpen, setBackupOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const versionsBehind = selected.update?.versionsBehind;
  const updateStatus = selected.update?.status || "unknown";
  const updateKnown = typeof versionsBehind === "number";
  const updateLabel = updateStatus === "reversion" ? "Reversion available" : updateKnown ? versionsBehind === 0 ? "Up to date" : `${versionsBehind} ${versionsBehind === 1 ? "version" : "versions"} behind` : "Version unknown";
  const updateVariant = updateStatus === "reversion" ? "warning" : !updateKnown ? "secondary" : versionsBehind > 0 ? "warning" : "success";
  const updateJob = jobs.find((job) => job.action === "update" && ["queued", "running"].includes(job.status));
  const updateProgress = Math.min(Math.max(Number(updateJob?.progress || (pendingAction === "update" ? 5 : 0)), 0), 100);
  const updateInProgress = Boolean(updateJob || pendingAction === "update");
  const confirmation = confirmAction ? LIFECYCLE_CONFIRMATION_COPY[confirmAction] : null;
  const actionPending = (action: LifecycleAction) => pendingAction === action;
  const actionDisabled = Boolean(pendingAction);

  function requestAction(action: LifecycleAction) {
    if (actionDisabled) return;
    if (action === "start") {
      runAction("start");
      return;
    }
    setConfirmAction(action);
  }

  function confirmSelectedAction() {
    if (!confirmAction) return;
    const nextAction = confirmAction;
    setConfirmAction(null);
    runAction(nextAction);
  }

  return (
    <div className="tab-content lifecycle-panel">
      <Card className="lifecycle-summary-card">
        <CardHeader>
          <div><CardTitle>Lifecycle</CardTitle><CardDescription>Control service state and update this agent.</CardDescription></div>
          <Badge variant={updateVariant}>{updateLabel}</Badge>
        </CardHeader>
        <CardContent className="lifecycle-summary-content">
          <DetailRow icon={Download} label="Current revision" value={selected.update?.currentRevision || "Unknown"} />
          {selected.update?.latestRevision ? <><Separator /><DetailRow icon={Clock} label="Latest revision" value={selected.update.latestRevision} /></> : null}
          {updateInProgress ? <><Separator /><div className="lifecycle-update-progress"><div><span>Updating</span><strong>{updateProgress}%</strong></div><Progress value={updateProgress} /></div></> : null}
        </CardContent>
      </Card>
      <Card className="lifecycle-section-card">
        <CardHeader>
          <div><CardTitle>Service controls</CardTitle><CardDescription>Start, stop, restart, or update this agent.</CardDescription></div>
        </CardHeader>
        <CardContent className="lifecycle-action-list">
          <LifecycleActionRow icon={Play} title="Start" description="Bring the agent services online." actionLabel="Start" pending={actionPending("start")} disabled={actionDisabled} onClick={() => requestAction("start")} />
          <Separator />
          <LifecycleActionRow icon={CircleStop} title="Stop" description="Take the agent services offline." actionLabel="Stop" variant="outline" pending={actionPending("stop")} disabled={actionDisabled} onClick={() => requestAction("stop")} />
          <Separator />
          <LifecycleActionRow icon={RotateCw} title="Restart" description="Restart services with a short interruption." actionLabel="Restart" variant="outline" pending={actionPending("restart")} disabled={actionDisabled} onClick={() => requestAction("restart")} />
          <Separator />
          <LifecycleActionRow icon={Download} title="Update" description="Run the update workflow for this agent." actionLabel="Update" variant="outline" pending={actionPending("update") || Boolean(updateJob)} disabled={actionDisabled} onClick={() => requestAction("update")} progress={updateInProgress ? updateProgress : undefined} />
        </CardContent>
      </Card>
      <Card className="lifecycle-section-card">
        <CardHeader>
          <div><CardTitle>Portability</CardTitle><CardDescription>Back up or duplicate this agent.</CardDescription></div>
        </CardHeader>
        <CardContent className="lifecycle-action-list">
          <LifecycleActionRow icon={Archive} title="Back up" description="Create a local archive for this agent." actionLabel="Back up" variant="outline" pending={false} disabled={actionDisabled} onClick={() => setBackupOpen(true)} />
          <Separator />
          <LifecycleActionRow icon={Library} title="Save as template" description="Capture a reusable secret-free template." actionLabel="Save" variant="outline" pending={false} disabled={actionDisabled || selected.nodeLocal === false || selected.runtime === "nemoclaw"} onClick={() => setTemplateOpen(true)} />
          <Separator />
          <LifecycleActionRow icon={CopyPlus} title="Clone" description="Create a new agent from this agent's state." actionLabel="Clone" variant="outline" pending={false} disabled={actionDisabled} onClick={() => setCloneOpen(true)} />
          <Separator />
          <LifecycleActionRow icon={MoveRight} title="Move" description="Transfer this agent to another Fleet node." actionLabel="Move" variant="outline" pending={false} disabled={actionDisabled} onClick={() => setMoveOpen(true)} />
        </CardContent>
      </Card>
      <Card className="lifecycle-danger-card">
        <CardHeader><div><CardTitle>Danger zone</CardTitle><CardDescription>Permanent actions that cannot be undone.</CardDescription></div><CircleAlert /></CardHeader>
        <CardContent className="padded lifecycle-danger-row">
          <div><strong>Remove agent</strong><span>Deletes this agent from the fleet permanently.</span></div>
          <Button disabled={actionDisabled} variant="destructive" onClick={() => requestAction("delete")}>{actionPending("delete") ? <Spinner data-icon="inline-start" /> : <Trash2 data-icon="inline-start" />}Delete</Button>
        </CardContent>
      </Card>
      <AlertDialog open={Boolean(confirmAction)} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}>
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
      <AgentBackupModal open={backupOpen} selected={selected} onClose={() => setBackupOpen(false)} onBackup={onBackupAgent} />
      <AgentTemplateCaptureModal open={templateOpen} selected={selected} onClose={() => setTemplateOpen(false)} onCapture={onCaptureTemplate} />
      <AgentCloneModal open={cloneOpen} selected={selected} onClose={() => setCloneOpen(false)} onClone={onCloneAgent} />
      <AgentMoveModal open={moveOpen} selected={selected} instances={instances} fleetNodes={fleetNodes} onClose={() => setMoveOpen(false)} onMove={onMoveAgent} />
    </div>
  );
}

function LifecycleActionRow({ icon: Icon, title, description, actionLabel, variant = "default", pending, disabled, onClick, progress }: {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel: string;
  variant?: "default" | "outline" | "destructive" | "ghost";
  pending: boolean;
  disabled: boolean;
  onClick: () => void;
  progress?: number;
}) {
  return (
    <div className="lifecycle-action-row">
      <div>
        <span className="lifecycle-action-icon"><Icon /></span>
        <div>
          <strong>{title}</strong>
          <span>{description}</span>
          {typeof progress === "number" ? <Progress value={progress} /> : null}
        </div>
      </div>
      <Button disabled={disabled} variant={variant} onClick={onClick}>
        {pending ? <Spinner data-icon="inline-start" /> : <Icon data-icon="inline-start" />}
        {actionLabel}
      </Button>
    </div>
  );
}
