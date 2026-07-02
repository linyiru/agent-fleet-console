import { Brain, Link2, Link2Off, Play, Plus, RefreshCw, Search, Square, Trash2 } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { Instance } from "../models/fleet.ts";
import { api, apiErrorMessage, deleteJson, postJson } from "../controllers/api.ts";
import { classNames, formatTime } from "../controllers/format.ts";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Input } from "../components/ui/input.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { Spinner } from "../components/ui/spinner.tsx";

type SharedMemoryHub = {
  exists: boolean;
  running: boolean;
  status: string;
  image: string;
  port: number;
  container: string;
  dbExists: boolean;
};

type SharedMemoryAgent = { name: string; linked: boolean };
type SharedMemoryLinkResult = SharedMemoryAgent & {
  restarted?: boolean;
  restartRequired?: boolean;
  skippedReason?: "not-running" | "status-unavailable";
  error?: string;
};

type SharedMemoryStatus = {
  hub: SharedMemoryHub;
  agents: SharedMemoryAgent[];
  kinds: string[];
};

type SharedMemoryEntry = {
  id: string;
  content: string;
  importance: number | null;
  timestamp: string;
  author: string;
  kind: string;
};

type EntriesResponse = { total: number; entries: SharedMemoryEntry[] };

const ENTRY_KINDS = ["meta", "preference", "correction", "identity"];

function displayContent(entry: SharedMemoryEntry) {
  return entry.content.replace(/^Surface (?:meta|preference|correction|identity|fact):\s*/i, "");
}

export function SettingsSharedMemoryTab({ instances }: { instances: Instance[] }) {
  const [status, setStatus] = useState<SharedMemoryStatus | null>(null);
  const [entries, setEntries] = useState<EntriesResponse | null>(null);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [draft, setDraft] = useState({ content: "", kind: "meta" });
  const [deleteTarget, setDeleteTarget] = useState<SharedMemoryEntry | null>(null);
  const [busyAction, setBusyAction] = useState("");
  const busy = Boolean(busyAction);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api<SharedMemoryStatus>("/api/shared-memory"));
    } catch (error: unknown) {
      toast.error("Could not load shared memory status", { description: apiErrorMessage(error) });
    }
  }, []);

  const loadEntries = useCallback(async (search = "") => {
    setEntriesLoading(true);
    try {
      const path = search ? `/api/shared-memory/entries?query=${encodeURIComponent(search)}` : "/api/shared-memory/entries";
      setEntries(await api<EntriesResponse>(path));
      setActiveQuery(search);
    } catch (error: unknown) {
      toast.error("Could not load shared memories", { description: apiErrorMessage(error) });
    } finally {
      setEntriesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    loadEntries();
  }, [loadStatus, loadEntries]);

  async function toggleHub() {
    if (!status) return;
    const action = status.hub.running ? "stop" : "start";
    setBusyAction("hub");
    try {
      await postJson("/api/shared-memory/hub", { action });
      toast.success(action === "start" ? "Memory hub started" : "Memory hub stopped", {
        description: action === "start" ? "Linked agents can reach shared memory again." : "Linked agents lose shared memory access until it restarts.",
      });
      await loadStatus();
    } catch (error: unknown) {
      toast.error(`Could not ${action} the memory hub`, { description: apiErrorMessage(error) });
    } finally {
      setBusyAction("");
    }
  }

  async function addEntry(event: FormEvent) {
    event.preventDefault();
    if (!draft.content.trim()) return;
    setBusyAction("add");
    try {
      await postJson("/api/shared-memory/entries", { content: draft.content.trim(), kind: draft.kind });
      setDraft({ content: "", kind: draft.kind });
      toast.success("Added to shared memory", { description: "Linked agents can now recall this entry." });
      await loadEntries(activeQuery);
    } catch (error: unknown) {
      toast.error("Could not add the entry", { description: apiErrorMessage(error) });
    } finally {
      setBusyAction("");
    }
  }

  async function confirmRemoveEntry() {
    const entry = deleteTarget;
    if (!entry) return;
    setDeleteTarget(null);
    setBusyAction(`delete:${entry.id}`);
    try {
      await deleteJson(`/api/shared-memory/entries/${encodeURIComponent(entry.id)}`);
      toast.success("Entry removed");
      await loadEntries(activeQuery);
    } catch (error: unknown) {
      toast.error("Could not remove the entry", { description: apiErrorMessage(error) });
    } finally {
      setBusyAction("");
    }
  }

  async function toggleLink(agent: SharedMemoryAgent) {
    setBusyAction(`link:${agent.name}`);
    try {
      const actionLabel = agent.linked ? "unlinked" : "linked";
      const result = agent.linked
        ? await deleteJson<SharedMemoryLinkResult>(`/api/shared-memory/agents/${encodeURIComponent(agent.name)}/link`)
        : await postJson<SharedMemoryLinkResult>(`/api/shared-memory/agents/${encodeURIComponent(agent.name)}/link`, {});
      if (agent.linked) {
        toastLinkResult(result, actionLabel, "Shared memory tools were removed.");
      } else {
        toastLinkResult(result, actionLabel, "Shared memory tools and skill are installed.");
      }
      await loadStatus();
    } catch (error: unknown) {
      toast.error(`Could not ${agent.linked ? "unlink" : "link"} ${agent.name}`, { description: apiErrorMessage(error) });
    } finally {
      setBusyAction("");
    }
  }

  function toastLinkResult(result: SharedMemoryLinkResult, actionLabel: string, baseDescription: string) {
    if (result.restarted) {
      toast.success(`${result.name} ${actionLabel} and restarted`, { description: `${baseDescription} The agent has loaded the change.` });
      return;
    }
    if (result.restartRequired || result.error) {
      toast.info(`${result.name} ${actionLabel}`, {
        description: result.error ? `Restart ${result.name} manually to apply it. ${result.error}` : `Restart ${result.name} manually to apply it.`,
      });
      return;
    }
    toast.success(`${result.name} ${actionLabel}`, {
      description: result.skippedReason === "not-running" ? `${baseDescription} It will load the change next time it starts.` : baseDescription,
    });
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    loadEntries(query.trim());
  }

  const hub = status?.hub;
  const localNames = new Set(instances.filter((instance) => instance.nodeLocal !== false).map((instance) => instance.name));
  const agents = (status?.agents || []).filter((agent) => localNames.size === 0 || localNames.has(agent.name));
  const linkedCount = agents.filter((agent) => agent.linked).length;
  const hubMeta = hub
    ? hub.running
      ? [`port ${hub.port}`, entries ? `${entries.total} ${entries.total === 1 ? "entry" : "entries"}` : null, `${linkedCount} linked`].filter(Boolean).join(" · ")
      : "Linked agents cannot recall shared memory until the hub starts."
    : "";

  return (
    <div className="settings-layout">
      <Card className="settings-section shared-memory-section">
        <CardHeader className="settings-section-header">
          <div>
            <CardTitle>Shared memory</CardTitle>
            <CardDescription>One Mnemosyne store every linked agent can recall from and contribute to. Agents keep their private memory.</CardDescription>
          </div>
          <Brain />
        </CardHeader>
        <CardContent className="settings-section-content shared-memory-hub-row">
          <div className="shared-memory-hub-copy">
            <span className={classNames("fleet-status-cell", hub?.running ? "good" : "muted")}>
              <span className={classNames("fleet-status-dot", hub?.running ? "good" : "muted")} aria-hidden="true" />
              {hub ? (hub.running ? "Hub running" : hub.exists ? "Hub stopped" : "Hub not created") : "Checking"}
            </span>
            {hubMeta ? <span className="shared-memory-hub-meta">{hubMeta}</span> : null}
          </div>
          <Button variant={hub?.running ? "outline" : "default"} size="sm" type="button" disabled={busy || !status} onClick={toggleHub}>
            {busyAction === "hub" ? <Spinner data-icon="inline-start" /> : hub?.running ? <Square data-icon="inline-start" /> : <Play data-icon="inline-start" />}
            {hub?.running ? "Stop hub" : "Start hub"}
          </Button>
        </CardContent>
      </Card>

      <Card className="settings-section shared-memory-section">
        <CardHeader className="settings-section-header">
          <div>
            <CardTitle>Add knowledge</CardTitle>
            <CardDescription>Stored as the console. Linked agents find it through semantic recall.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="settings-section-content">
          <form className="shared-memory-composer" onSubmit={addEntry}>
            <textarea
              value={draft.content}
              onChange={(event) => setDraft({ ...draft, content: event.target.value })}
              placeholder="One durable fact per entry, e.g. “Weekly board report is compiled every Friday by board-reporting.”"
              rows={3}
              maxLength={4000}
            />
            <div className="shared-memory-composer-actions">
              <label className="shared-memory-kind-field">
                <span>Kind</span>
                <select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value })}>
                  {ENTRY_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
                </select>
              </label>
              <Button type="submit" disabled={busy || !draft.content.trim()}>
                {busyAction === "add" ? <Spinner data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
                Add entry
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="settings-section shared-memory-section">
        <CardHeader className="settings-section-header">
          <div>
            <CardTitle>Entries</CardTitle>
            <CardDescription>{activeQuery ? `Recall results for “${activeQuery}”` : "Most recent first."}</CardDescription>
          </div>
          <Button variant="ghost" size="icon" type="button" aria-label="Refresh entries" disabled={entriesLoading} onClick={() => loadEntries(activeQuery)}>
            <RefreshCw className={entriesLoading ? "spin" : undefined} />
          </Button>
        </CardHeader>
        <CardContent className="settings-section-content">
          <form className="shared-memory-search" onSubmit={submitSearch}>
            <label className="fleet-search-field">
              <Search aria-hidden="true" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search shared memory" />
            </label>
            {activeQuery ? (
              <Button variant="ghost" size="sm" type="button" onClick={() => { setQuery(""); loadEntries(""); }}>Clear</Button>
            ) : null}
          </form>
          {entriesLoading && !entries ? (
            <div className="shared-memory-skeleton" aria-hidden="true">
              <Skeleton />
              <Skeleton />
              <Skeleton />
            </div>
          ) : entries && entries.entries.length ? (
            <div className="shared-memory-entry-list">
              {entries.entries.map((entry) => (
                <article key={entry.id} className="shared-memory-entry">
                  <p>{displayContent(entry)}</p>
                  <div className="shared-memory-entry-meta">
                    <span>{entry.kind || "meta"}</span>
                    <span>{entry.author || "unknown"}</span>
                    {entry.timestamp ? <span>{formatTime(entry.timestamp)}</span> : null}
                    <Button
                      variant="ghost"
                      size="icon"
                      type="button"
                      aria-label={`Delete entry ${entry.id}`}
                      disabled={busy}
                      onClick={() => setDeleteTarget(entry)}
                    >
                      {busyAction === `delete:${entry.id}` ? <Spinner /> : <Trash2 />}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="shared-memory-empty">
              {activeQuery ? "No entries match this recall query." : "Shared memory is empty. Add the first entry above, or link an agent and let it contribute."}
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="settings-section shared-memory-section">
        <CardHeader className="settings-section-header">
          <div>
            <CardTitle>Linked agents</CardTitle>
            <CardDescription>Linking adds the shared memory tools and a usage skill. Running agents restart automatically; stopped agents load the change next start.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="settings-section-content">
          {agents.length ? (
            <div className="settings-node-list">
              {agents.map((agent) => (
                <div key={agent.name} className="settings-node-row">
                  <div>
                    <strong>{agent.name}</strong>
                    <span>{agent.linked ? "Shared memory tools and skill installed" : "Private memory only"}</span>
                  </div>
                  <span className={classNames("fleet-status-cell", agent.linked ? "good" : "muted")}>
                    <span className={classNames("fleet-status-dot", agent.linked ? "good" : "muted")} aria-hidden="true" />
                    {agent.linked ? "Linked" : "Unlinked"}
                  </span>
                  <div className="settings-node-actions">
                    <Button variant="outline" size="sm" type="button" disabled={busy} onClick={() => toggleLink(agent)}>
                      {busyAction === `link:${agent.name}` ? <Spinner data-icon="inline-start" /> : agent.linked ? <Link2Off data-icon="inline-start" /> : <Link2 data-icon="inline-start" />}
                      {agent.linked ? "Unlink" : "Link"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="shared-memory-empty">No local agents found. Remote-node agents are linked from their own console.</p>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this shared memory entry?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? `“${displayContent(deleteTarget).slice(0, 140)}${displayContent(deleteTarget).length > 140 ? "…" : ""}” ` : ""}
              Linked agents will no longer recall it. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmRemoveEntry}>Remove entry</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
