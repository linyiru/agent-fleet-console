import { CopyPlus, X } from "lucide-react";
import { FormEvent, useState } from "react";
import type { AgentCloneOptions, Instance } from "../models/fleet.ts";
import { AGENT_NAME_PATTERN, slugifyAgentName } from "../models/fleet.ts";
import { Button } from "../components/ui/button.tsx";
import { CardContent, CardFooter, CardForm } from "../components/ui/card.tsx";
import { Checkbox } from "../components/ui/checkbox.tsx";
import { DialogContent, DialogDescription, DialogHeader, DialogOverlay, DialogTitle } from "../components/ui/dialog.tsx";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "../components/ui/field.tsx";
import { Input } from "../components/ui/input.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { toast } from "sonner";

export function AgentCloneModal({ open, selected, onClose, onClone }: {
  open: boolean;
  selected: Instance;
  onClose: () => void;
  onClone: (name: string, options: AgentCloneOptions) => Promise<void>;
}) {
  const [name, setName] = useState(`${selected.name}-copy`);
  const [copyWorkspace, setCopyWorkspace] = useState(true);
  const [copyCredentials, setCopyCredentials] = useState(true);
  const [start, setStart] = useState(true);
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  const newName = slugifyAgentName(name);
  const valid = AGENT_NAME_PATTERN.test(newName) && newName !== selected.name;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      await onClone(selected.name, { newName, copyWorkspace, copyCredentials, start });
      toast.success("Clone queued", { description: `${selected.name} -> ${newName}` });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogOverlay onClick={onClose}>
      <DialogContent className="create-agent-modal" onClick={(event) => event.stopPropagation()}>
        <DialogHeader>
          <div><DialogTitle>Clone {selected.name}</DialogTitle><DialogDescription>Create a new agent from this agent's local state.</DialogDescription></div>
          <Button variant="outline" size="icon" aria-label="Close clone" onClick={onClose}><X data-icon="inline-start" /></Button>
        </DialogHeader>
        <CardForm onSubmit={submit}>
          <CardContent className="padded">
            <FieldGroup>
              <Field data-invalid={Boolean(name && !valid) || undefined}>
                <FieldLabel htmlFor="clone-name">New agent name</FieldLabel>
                <Input id="clone-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="research-agent-copy" autoFocus aria-invalid={Boolean(name && !valid)} />
                <FieldDescription>{name && !valid ? `Use ${newName || "agent-copy"}.` : "Lowercase letters, numbers, hyphens, and underscores."}</FieldDescription>
              </Field>
              <label className="backup-option"><Checkbox checked={copyWorkspace} onChange={(event) => setCopyWorkspace(event.target.checked)} /><span><strong>Workspace</strong><small>Copy project files, excluding generated folders.</small></span></label>
              <label className="backup-option warning"><Checkbox checked={copyCredentials} onChange={(event) => setCopyCredentials(event.target.checked)} /><span><strong>Credentials</strong><small>Copy this agent's local env secrets.</small></span></label>
              <label className="backup-option"><Checkbox checked={start} onChange={(event) => setStart(event.target.checked)} /><span><strong>Start clone</strong><small>Bring services online after cloning.</small></span></label>
            </FieldGroup>
          </CardContent>
          <CardFooter className="create-agent-footer">
            <Button variant="outline" type="button" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button disabled={!valid || busy}>{busy ? <Spinner data-icon="inline-start" /> : <CopyPlus data-icon="inline-start" />}Clone agent</Button>
          </CardFooter>
        </CardForm>
      </DialogContent>
    </DialogOverlay>
  );
}
