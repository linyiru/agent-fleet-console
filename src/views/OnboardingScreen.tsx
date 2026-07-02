import { CheckCircle2, CircleAlert, CircleX, Clipboard, Plus, RefreshCw, Settings2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { BaselineCheck, BaselineStatus } from "../models/fleet.ts";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { DashboardPageStack } from "../components/layout/FleetShell.tsx";

const CHECK_LABELS: Record<string, string> = {
  "project bin directory": "Project tools",
  "hermes-docker wrapper": "Hermes Docker command",
  "hermes-docker executable": "Hermes Docker executable",
  "hermes-console wrapper": "Hermes console command",
  "Runtime env file": "Runtime config",
  "Hermes instances root": "Agent storage",
  "Console data directory parent": "Console data folder",
  "Console DB directory parent": "Console database folder",
  "Camofox Docker context": "Browser container context",
  "Camofox Dockerfile": "Browser container recipe",
  "Webhost Docker context": "Web host context",
  "Webhost Dockerfile": "Web host recipe",
};

function checkVariant(check: BaselineCheck) {
  return check.severity === "warn" ? "warning" as const : "destructive" as const;
}

function checkIcon(check: BaselineCheck) {
  if (check.ok) return <CheckCircle2 />;
  return check.severity === "warn" ? <CircleAlert /> : <CircleX />;
}

type SetupPreviewState = "ready" | "warning" | "blocked" | "loading" | "empty";

function readSetupPreviewState(): SetupPreviewState | "" {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  const value = (params.get("setupPreview") || params.get("setupState") || "").trim().toLowerCase();
  return ["ready", "warning", "blocked", "loading", "empty"].includes(value) ? value as SetupPreviewState : "";
}

function previewCheck(label: string, detail = "Ready"): BaselineCheck {
  return { ok: true, label, detail, fix: "", severity: "warn" };
}

const PREVIEW_READY_CHECKS: BaselineCheck[] = [
  previewCheck("Node.js 20+", "current v22.16.0"),
  previewCheck("npm", "10.9.2"),
  previewCheck("Docker CLI", "Docker available"),
  previewCheck("Docker Compose", "Compose available"),
  previewCheck("Runtime env file", ".env"),
  previewCheck("Hermes instances root", "~/Documents/GitHub/fleet"),
  previewCheck("Camofox Dockerfile", "docker/camofox/Dockerfile"),
  previewCheck("Webhost Dockerfile", "docker/webhost/Dockerfile"),
];

function previewBaseline(state: SetupPreviewState): BaselineStatus | null {
  if (state === "loading") return null;
  if (state === "empty") {
    return { ok: false, appRoot: "", loadedEnvFiles: [], resolved: {}, checks: [], errors: [], warnings: [] };
  }

  const warnings: BaselineCheck[] = state === "warning"
    ? [{ ok: false, label: "NemoHermes CLI", detail: "nemohermes missing", fix: "Run the NVIDIA NemoHermes installer, or set NEMOHERMES_BIN for stricter hosts.", severity: "warn" }]
    : [];
  const errors: BaselineCheck[] = state === "blocked"
    ? [
      { ok: false, label: "Docker CLI", detail: "Docker is not available", fix: "Start Docker Desktop, then recheck setup.", severity: "error" },
      { ok: false, label: "Runtime env file", detail: ".env missing", fix: "Run npm run setup from the project root.", severity: "error" },
    ]
    : [];
  return {
    ok: !errors.length,
    appRoot: "~/Documents/GitHub/fleet/agent-fleet-console",
    loadedEnvFiles: [".env"],
    resolved: {},
    checks: [...PREVIEW_READY_CHECKS, ...warnings, ...errors],
    errors,
    warnings,
  };
}

export function OnboardingScreen({
  baseline,
  loading,
  onCreateAgent,
  onOpenSettings,
  onRefresh,
}: {
  baseline: BaselineStatus | null;
  loading: boolean;
  onCreateAgent: () => void;
  onOpenSettings: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [showAllChecks, setShowAllChecks] = useState(false);
  const [copied, setCopied] = useState(false);
  const previewState = readSetupPreviewState();
  const effectiveLoading = previewState === "loading" ? true : loading;
  const effectiveBaseline = previewState ? previewBaseline(previewState) : baseline;
  const checks = effectiveBaseline?.checks || [];
  const failures = useMemo(() => checks.filter((check) => !check.ok), [checks]);
  const ready = effectiveBaseline?.ok || false;
  const warningCount = effectiveBaseline?.warnings?.length || 0;
  const checksToShow = showAllChecks ? checks : failures;
  const hasMoreChecks = checks.length > checksToShow.length;
  const emptyChecksText = failures.length ? "No checks match this filter." : checks.length ? "All setup checks are passing." : "No setup checks have run yet.";
  const checkCountLabel = effectiveLoading ? "Checking" : `${checks.length} ${checks.length === 1 ? "check" : "checks"}`;
  const issueText = effectiveLoading
    ? "Running checks"
    : failures.length
      ? `${failures.length} issue${failures.length === 1 ? "" : "s"} ${failures.length === 1 ? "needs" : "need"} attention`
      : checks.length ? "All setup checks are passing" : "No setup checks have run yet";
  const nextStepTitle = effectiveLoading ? "Checking prerequisites" : ready ? "Ready for an agent" : "Setup is blocked";
  const nextStepDetail = effectiveLoading
    ? "The console is checking Docker, local paths, and runtime files."
    : ready
      ? warningCount ? "Warnings do not block agent creation. Review them when you have a minute." : "Create an agent now, or tune provider settings first."
      : checks.length ? "Run setup from the project root, then recheck this page." : "Run setup once, then recheck this page.";
  const setupCommand = "npm run setup";

  async function copySetupCommand() {
    await navigator.clipboard?.writeText(setupCommand);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <DashboardPageStack
      className="onboarding-page"
      leading={previewState ? <Badge variant="secondary">Preview</Badge> : undefined}
      title={ready ? "Setup complete" : "Setup checks"}
      actions={
        <Button type="button" variant="outline" onClick={onRefresh} disabled={effectiveLoading}>
          {effectiveLoading ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
          Recheck
        </Button>
      }
    >
      <div className="onboarding-body">
        <section className={`onboarding-next-step ${effectiveLoading ? "loading" : ready ? "ready" : "attention"}`} aria-label="Recommended setup action">
          <div>
            <strong>{nextStepTitle}</strong>
            <span>{nextStepDetail}</span>
          </div>
          {ready ? (
            <div className="onboarding-next-actions">
              <Button className="fleet-primary-action" type="button" onClick={onCreateAgent}>
                <Plus data-icon="inline-start" />
                Create agent
              </Button>
              <Button type="button" variant="outline" onClick={onOpenSettings}>
                <Settings2 data-icon="inline-start" />
                Provider settings
              </Button>
            </div>
          ) : effectiveLoading ? null : (
            <div className="onboarding-command-copy">
              <code>{setupCommand}</code>
              <Button type="button" variant="outline" onClick={copySetupCommand}>
                <Clipboard data-icon="inline-start" />
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          )}
        </section>

        <section className="onboarding-checks" aria-label="Setup checks list">
          <header>
            <div>
              <strong>Checks</strong>
              <span>{issueText}</span>
            </div>
            <Badge>{checkCountLabel}</Badge>
          </header>

          {effectiveLoading ? (
            <OnboardingSkeleton />
          ) : checksToShow.length ? (
            <div className="onboarding-check-list">
              {checksToShow.map((check) => <CheckRow key={check.label} check={check} />)}
            </div>
          ) : (
            <p className="onboarding-check-empty">{emptyChecksText}</p>
          )}

          {hasMoreChecks ? (
            <div className="onboarding-checks-footer">
              <Button type="button" variant="outline" size="sm" onClick={() => setShowAllChecks((open) => !open)}>
                {showAllChecks ? "Show issues only" : "Show all checks"}
              </Button>
            </div>
          ) : null}
        </section>
      </div>
    </DashboardPageStack>
  );
}

function CheckRow({ check }: { check: BaselineCheck }) {
  return (
    <article className={`onboarding-check-row ${check.ok ? "tone-ok" : `tone-${check.severity}`}`}>
      <span className="onboarding-check-icon" aria-hidden="true">{checkIcon(check)}</span>
      <div>
        <strong title={check.label}>{CHECK_LABELS[check.label] || check.label}</strong>
        <span>{check.detail || (check.ok ? "Ready" : "Needs attention")}</span>
        {!check.ok && check.fix ? <small>{check.fix}</small> : null}
      </div>
      {check.ok ? null : <Badge className="onboarding-check-badge" variant={checkVariant(check)}>{check.severity === "warn" ? "Warning" : "Required"}</Badge>}
    </article>
  );
}

function OnboardingSkeleton() {
  return (
    <div className="onboarding-skeleton">
      <Skeleton />
      <Skeleton />
      <Skeleton />
    </div>
  );
}
