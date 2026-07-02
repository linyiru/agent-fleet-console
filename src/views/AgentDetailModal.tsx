import { Bot, BriefcaseBusiness, CalendarClock, Edit3, Globe2, MessageCircle, MessagesSquare, RotateCw, ServerCog, SquareActivity, X } from "lucide-react";
import { useState } from "react";
import type { AgentBackupOptions, AgentCloneOptions, AgentMoveOptions, AgentTemplateCaptureOptions, FleetNode, Instance, Job, TelegramAgentOptions } from "../models/fleet.ts";
import { isAgentReady } from "../controllers/format.ts";
import { Button } from "../components/ui/button.tsx";
import { DialogContent, DialogHeader, DialogOverlay, DialogTitle } from "../components/ui/dialog.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.tsx";
import { GatewayPanel } from "./GatewayPanel.tsx";
import { ServicesPanel } from "./AgentAdvancedPanels.tsx";
import { ChatPanel } from "./ChatPanel.tsx";
import { DetailsPanel } from "./AgentDetailsPanel.tsx";
import { JobsPanel } from "./AgentJobsPanel.tsx";
import { LifecyclePanel } from "./AgentLifecyclePanel.tsx";
import { AgentRenameModal } from "./AgentRenameModal.tsx";
import { AgentCronsPanel } from "./AgentCronsPanel.tsx";
import { AgentTelegramModal } from "./AgentTelegramModal.tsx";

const ADVANCED_TABS = [
  { label: "Chat", icon: MessagesSquare },
  { label: "Details", icon: SquareActivity },
  { label: "Lifecycle", icon: RotateCw },
  { label: "Jobs", icon: BriefcaseBusiness },
  { label: "CRONs", icon: CalendarClock },
  { label: "Gateway", icon: Globe2 },
  { label: "Services", icon: ServerCog },
];

export function AgentDetailModal({ open, onClose, selected, jobs, instances, pendingAction, onBackupAgent, onCaptureTemplate, onCloneAgent, onMoveAgent, onConnectTelegram, onRenameAgent, fleetNodes, runAction, cancelJob, refresh, openAgent }: {
  open: boolean;
  onClose: () => void;
  selected: Instance | null;
  jobs: Job[];
  instances: Instance[];
  pendingAction: string;
  onBackupAgent: (name: string, options: AgentBackupOptions) => Promise<void>;
  onCaptureTemplate: (name: string, options: AgentTemplateCaptureOptions, nodeId?: string) => Promise<void>;
  onCloneAgent: (name: string, options: AgentCloneOptions) => Promise<void>;
  onMoveAgent: (name: string, options: AgentMoveOptions, nodeId?: string) => Promise<void>;
  onConnectTelegram: (name: string, telegram: TelegramAgentOptions, nodeId?: string) => Promise<void>;
  onRenameAgent: (name: string, displayName: string, nodeId?: string) => Promise<void>;
  fleetNodes: FleetNode[];
  runAction: (action: string) => Promise<void>;
  cancelJob: (job: Job) => void;
  refresh: () => void;
  openAgent: (name: string, nodeId?: string) => void;
}) {
  const [tab, setTab] = useState("Chat");
  const [renameOpen, setRenameOpen] = useState(false);
  const [telegramOpen, setTelegramOpen] = useState(false);
  if (!open || !selected || !isAgentReady(selected, jobs)) return null;
  const selectedNodeId = selected.nodeId || "local";
  const selectedJobs = jobs.filter((job) => job.instance === selected.name && (
    (job.nodeId || "local") === selectedNodeId
    || (job.action === "fleet-move" && job.payload?.sourceNodeId === selectedNodeId)
  ));
  const lanAddress = selected.network?.lanAddress || "127.0.0.1";
  const healthPort = selected.ports?.health || "n/a";
  const displayName = String(selected.displayName || "").trim() || selected.name;
  return (
    <DialogOverlay onClick={onClose}>
      <DialogContent className="agent-detail-modal" onClick={(event) => event.stopPropagation()}>
        <DialogHeader className="detail-header">
          <div className="detail-identity">
              <span className="detail-agent-mark"><Bot /></span>
            <div className="detail-title-block">
              <span className="detail-eyebrow">Agent control</span>
              <DialogTitle>{displayName}</DialogTitle>
              <span>{selected.displayName ? `Agent id ${selected.name}` : selected.pendingCreate ? "Getting ready" : `LAN ${lanAddress}:${healthPort}`}</span>
            </div>
          </div>
          <div className="detail-command-strip">
            <Button variant="outline" size="sm" type="button" onClick={() => setTelegramOpen(true)}><MessageCircle data-icon="inline-start" />Telegram</Button>
            <Button variant="outline" size="sm" type="button" onClick={() => setRenameOpen(true)}><Edit3 data-icon="inline-start" />Rename</Button>
            <Button className="detail-close-button" variant="outline" size="icon" aria-label="Close" onClick={onClose}><X data-icon="inline-start" /></Button>
          </div>
        </DialogHeader>
        <Tabs className="advanced-panel">
          <div className="agent-detail-nav-shell">
            <TabsList className="agent-detail-tabs" role="tablist" aria-label="Agent detail sections">
              {ADVANCED_TABS.map(({ label, icon: Icon }) => (
                <TabsTrigger className="agent-detail-tab" key={label} role="tab" aria-selected={tab === label} active={tab === label} onClick={() => setTab(label)}>
                  <span className="agent-detail-tab-icon"><Icon /></span>
                  <span>{label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <div >
            <div className="agent-detail-workspace-core" key={tab}>
              {tab === "Chat" ? (
                <TabsContent className="agent-detail-content agent-modal-chat" role="tabpanel">
                  <ChatPanel selected={selected} jobs={jobs} instances={instances} openAgent={openAgent} />
                </TabsContent>
              ) : tab === "Details" ? (
                <TabsContent className="agent-detail-content" role="tabpanel"><DetailsPanel selected={selected} /></TabsContent>
              ) : tab === "Lifecycle" ? (
                <TabsContent className="agent-detail-content" role="tabpanel"><LifecyclePanel selected={selected} jobs={selectedJobs} instances={instances} fleetNodes={fleetNodes} pendingAction={pendingAction} onBackupAgent={onBackupAgent} onCaptureTemplate={(name, options) => onCaptureTemplate(name, options, selectedNodeId)} onCloneAgent={onCloneAgent} onMoveAgent={(name, options) => onMoveAgent(name, options, selectedNodeId)} runAction={runAction} /></TabsContent>
              ) : tab === "Jobs" ? (
                <TabsContent className="agent-detail-content" role="tabpanel"><JobsPanel selected={selected} jobs={selectedJobs} cancelJob={cancelJob} /></TabsContent>
              ) : tab === "CRONs" ? (
                <TabsContent className="agent-detail-content" role="tabpanel"><AgentCronsPanel selected={selected} /></TabsContent>
              ) : tab === "Gateway" ? (
                <TabsContent className="agent-detail-content" role="tabpanel"><GatewayPanel selected={selected} refresh={refresh} /></TabsContent>
              ) : tab === "Services" ? (
                <TabsContent className="agent-detail-content" role="tabpanel"><ServicesPanel selected={selected} /></TabsContent>
              ) : (
                <TabsContent className="agent-detail-content" role="tabpanel"><DetailsPanel selected={selected} /></TabsContent>
              )}
            </div>
          </div>
        </Tabs>
        <AgentRenameModal open={renameOpen} selected={selected} onClose={() => setRenameOpen(false)} onRename={onRenameAgent} />
        <AgentTelegramModal open={telegramOpen} selected={selected} onClose={() => setTelegramOpen(false)} onConnect={onConnectTelegram} />
      </DialogContent>
    </DialogOverlay>
  );
}
