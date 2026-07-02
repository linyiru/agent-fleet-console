import { Library, X } from "lucide-react";
import { FormEvent, useState } from "react";
import type { AgentTemplateCaptureOptions, Instance } from "../models/fleet.ts";
import { Alert } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { CardContent, CardFooter, CardForm } from "../components/ui/card.tsx";
import { Checkbox } from "../components/ui/checkbox.tsx";
import { DialogContent, DialogDescription, DialogHeader, DialogOverlay, DialogTitle } from "../components/ui/dialog.tsx";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "../components/ui/field.tsx";
import { Input, Textarea } from "../components/ui/input.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { toast } from "sonner";

export function AgentTemplateCaptureModal({ open, selected, onClose, onCapture }: {
  open: boolean;
  selected: Instance;
  onClose: () => void;
  onCapture: (name: string, options: AgentTemplateCaptureOptions) => Promise<void>;
}) {
  const defaultName = `${selected.displayName || selected.name} template`;
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState("");
  const [includeWorkspace, setIncludeWorkspace] = useState(true);
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  const localDocker = selected.runtime !== "nemoclaw" && selected.nodeLocal !== false;
  const canSubmit = localDocker && Boolean(name.trim()) && !busy;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      await onCapture(selected.name, { name: name.trim(), description: description.trim(), includeWorkspace });
      toast.success("Template saved", { description: name.trim() });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogOverlay onClick={onClose}>
      <DialogContent className="create-agent-modal" onClick={(event) => event.stopPropagation()}>
        <DialogHeader>
          <div><DialogTitle>Save {selected.name} as template</DialogTitle><DialogDescription>Create a reusable secret-free template.</DialogDescription></div>
          <Button variant="outline" size="icon" aria-label="Close template capture" onClick={onClose}><X data-icon="inline-start" /></Button>
        </DialogHeader>
        <CardForm onSubmit={submit}>
          <CardContent className="padded">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="template-name">Template name</FieldLabel>
                <Input id="template-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
              </Field>
              <Field>
                <FieldLabel htmlFor="template-description">Description</FieldLabel>
                <Textarea id="template-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
                <FieldDescription>Secret values are never included. Fleet records only required secret names.</FieldDescription>
              </Field>
              <label className="backup-option"><Checkbox checked={includeWorkspace} onChange={(event) => setIncludeWorkspace(event.target.checked)} /><span><strong>Workspace</strong><small>Include project files, excluding generated folders.</small></span></label>
            </FieldGroup>
            {!localDocker ? <Alert variant="warning">Template capture is available for local Docker Hermes agents.</Alert> : null}
          </CardContent>
          <CardFooter className="create-agent-footer">
            <Button variant="outline" type="button" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button disabled={!canSubmit}>{busy ? <Spinner data-icon="inline-start" /> : <Library data-icon="inline-start" />}Save template</Button>
          </CardFooter>
        </CardForm>
      </DialogContent>
    </DialogOverlay>
  );
}
