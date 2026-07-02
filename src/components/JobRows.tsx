import { BriefcaseBusiness, CircleStop } from "lucide-react";
import { useState } from "react";
import { formatTime } from "../controllers/format.ts";
import type { Job } from "../models/fleet.ts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty.tsx";
import { Progress } from "./ui/progress.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table.tsx";

function jobStatusTone(status: string) {
  if (status === "completed") return "good";
  if (status === "failed" || status === "canceled") return "warn";
  if (status === "queued" || status === "running") return "info";
  return "muted";
}

function jobPreview(job: Job, limit: number) {
  const preview = (job.error || job.output || "").split(/\r?\n/).find(Boolean) || "";
  return preview.length > limit ? `${preview.slice(0, limit - 3)}...` : preview;
}

function jobProgress(job: Job) {
  return Math.min(Math.max(Number(job.progress || 0), 0), 100);
}

export function JobsTable({ title = "Recent jobs", description, jobs, cancelJob }: {
  title?: string;
  description?: string;
  jobs: Job[];
  cancelJob?: (job: Job) => void;
}) {
  const [cancelTarget, setCancelTarget] = useState<Job | null>(null);
  const activeCount = jobs.filter((job) => ["queued", "running"].includes(job.status)).length;

  function confirmCancel() {
    if (!cancelTarget || !cancelJob) return;
    const job = cancelTarget;
    setCancelTarget(null);
    cancelJob(job);
  }

  return (
    <Card className="jobs-card">
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {activeCount ? <Badge variant="default">{activeCount} active</Badge> : null}
      </CardHeader>
      <CardContent className="jobs-card-content">
        {jobs.length ? (
          <Table className="jobs-table">
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="ui-table-actions">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => {
                const progress = jobProgress(job);
                const preview = jobPreview(job, 110);
                const active = ["queued", "running"].includes(job.status);
                return (
                  <TableRow key={job.id}>
                    <TableCell>
                      <div className="job-table-primary">
                        <strong>#{job.id} {job.action}</strong>
                        <span>{job.instance || "fleet"} · {formatTime(job.createdAt)}</span>
                        {preview ? <p>{preview}</p> : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={`fleet-status-cell ${jobStatusTone(job.status)}`}>
                        <span className={`fleet-status-dot ${jobStatusTone(job.status)}`} aria-hidden="true" />
                        {job.status}
                      </span>
                    </TableCell>
                    <TableCell>
                      {active ? (
                        <div className="job-table-progress">
                          <span>{progress}%</span>
                          <Progress value={progress} />
                        </div>
                      ) : (
                        <span className="job-table-progress-final">{progress}%</span>
                      )}
                    </TableCell>
                    <TableCell><span className="job-table-time">{formatTime(job.createdAt)}</span></TableCell>
                    <TableCell className="ui-table-actions">
                      {active && cancelJob ? (
                        <Button variant="outline" size="sm" type="button" onClick={() => setCancelTarget(job)}>
                          <CircleStop data-icon="inline-start" />
                          Cancel
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <Empty className="jobs-empty">
            <EmptyMedia variant="icon"><BriefcaseBusiness /></EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>No jobs recorded</EmptyTitle>
              <EmptyDescription>{description || "This agent has not queued any jobs yet."}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
      <AlertDialog open={Boolean(cancelTarget)} onOpenChange={(open) => { if (!open) setCancelTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel job #{cancelTarget?.id}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will request cancellation for the running job. Any work already completed by the agent may remain in place.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep running</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmCancel}>Cancel job</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
