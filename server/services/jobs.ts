import { BUILD_TIMEOUT_MS, HERMES_DOCKER, validators } from "../config.ts";
import { db } from "../database.ts";
import { cancelProcess, jobErrorText, run } from "../lib/process.ts";
import { sanitizeJsonText } from "../lib/sanitize.ts";
import { nowIso } from "../lib/time.ts";
import { applyGlobalConfigToInstance, syncGlobalConfigToInstances } from "./global-config.ts";
import { discoverInstanceNames, instanceSnapshot, runManager } from "./instances.ts";
import { applyTemplateToInstance, getTemplate } from "./templates.ts";
import { parseJson, recordEvent, rowToJob } from "./records.ts";
import { resolveChatJobResult, runChatJob } from "./sessions.ts";
import { cloneInstance, exportBackup, restoreBackup } from "./backups.ts";
import { runFleetMove } from "./fleet-move.ts";
import { allocateInstancePorts } from "./ports.ts";
import { writeWebInstructions } from "./web-hosting.ts";
import os from "node:os";
import { createNemoHermesSandbox, isNemoClawInstance, runNemoHermesAction } from "./nemoclaw.ts";
import { applyCreateCapabilities } from "./capabilities.ts";
import { applyTelegramSetupToInstance } from "./telegram-onboarding.ts";
import { runTemplateDeploy } from "./template-library.ts";

let runnerActive = false;

function lanAddress() {
  for (const rows of Object.values(os.networkInterfaces())) {
    for (const row of rows || []) {
      if (row.family === "IPv4" && !row.internal) return row.address;
    }
  }
  return "127.0.0.1";
}

export function createJob(action: string, instance = "", payload: any = {}, requestedBy = "local") {
  const createdAt = nowIso();
  const result = db.prepare(`
    INSERT INTO jobs (action, instance, status, progress, payload_json, requested_by, created_at)
    VALUES (?, ?, 'queued', 0, ?, ?, ?)
  `).run(instance ? action : action, instance || "", JSON.stringify(payload || {}), requestedBy, createdAt);
  const job = getJob(Number(result.lastInsertRowid));
  processJobs();
  return job;
}

export function getJob(id: number) {
  return rowToJob(db.prepare("SELECT * FROM jobs WHERE id = ?").get(id));
}

export function recentJobs(limit = 50) {
  return db.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?").all(Number(limit)).map(rowToJob);
}

function updateJob(id: number, fields: any) {
  const current = getJob(id);
  if (!current) return null;
  db.prepare(`
    UPDATE jobs SET status = ?, progress = ?, output = ?, error = ?, result_json = ?,
      started_at = COALESCE(?, started_at), completed_at = COALESCE(?, completed_at)
    WHERE id = ?
  `).run(
    fields.status || current.status,
    fields.progress ?? current.progress,
    sanitizeJsonText(fields.output ?? current.output),
    sanitizeJsonText(fields.error ?? current.error),
    JSON.stringify(fields.result ?? current.result ?? {}),
    fields.startedAt || null,
    fields.completedAt || null,
    id,
  );
  return getJob(id);
}

async function withProgressHeartbeat<T>(jobId: number, start: number, ceiling: number, work: () => Promise<T>) {
  let progress = start;
  const timer = setInterval(() => {
    progress = Math.min(ceiling, progress + 1);
    updateJob(jobId, { progress });
  }, 8000);
  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
}

export function cancelJob(id: number) {
  const job = getJob(id);
  if (!job || !["queued", "running"].includes(job.status)) return job;
  cancelProcess(id);
  return updateJob(id, { status: "canceled", error: "Canceled by user.", completedAt: nowIso() });
}

async function runDockerAction(job: any) {
  const payload = job.payload || {};
  switch (job.action) {
    case "create": {
      const template = getTemplate(validators.validateTemplateId(payload.templateId || "blank"));
      if (!template) throw new Error("Unknown template");
      updateJob(job.id, { progress: 10 });
      const dependencies = validators.normalizeCreateDependencies(payload.dependencies || {});
      const capabilities = validators.normalizeCreateCapabilities(payload.capabilities || {});
      const telegram = validators.normalizeCreateTelegramSetup(payload.telegram || {});
      if (payload.runtime === "nemoclaw") {
        validators.validateNemoClawName(job.instance);
        const ports = await allocateInstancePorts(false);
        const onboard = await createNemoHermesSandbox(job.instance, ports.dashboard, job.id, BUILD_TIMEOUT_MS);
        updateJob(job.id, { progress: 70 });
        const telegramResult = await applyTelegramSetupToInstance(job.instance, telegram, "nemoclaw");
        const applied = await applyCreateCapabilities(job.instance, capabilities, "nemoclaw");
        return { output: [onboard.stdout, onboard.stderr].filter(Boolean).join("\n"), result: { instance: job.instance, runtime: "nemoclaw", capabilities: applied, messaging: telegramResult } };
      }
      const ports = await allocateInstancePorts(dependencies.camofox);
      const args = ["deploy", job.instance, "--dashboard-port", String(ports.dashboard), "--health-port", String(ports.health), "--web-port", String(ports.web)];
      if (ports.vnc) args.push("--vnc-port", String(ports.vnc));
      if (!dependencies.camofox) args.push("--without-camofox");
      const deploy = await withProgressHeartbeat(job.id, 10, 68, () => run(HERMES_DOCKER, args, { jobId: job.id, timeout: BUILD_TIMEOUT_MS, maxBuffer: 1024 * 1024 * 8 }));
      updateJob(job.id, { progress: 70 });
      const contextFiles = validators.normalizeCreateContextFiles(payload.contextFiles || {});
      await applyTemplateToInstance(job.instance, template, contextFiles);
      await writeWebInstructions(job.instance, lanAddress());
      await applyGlobalConfigToInstance(job.instance);
      const telegramResult = await applyTelegramSetupToInstance(job.instance, telegram, "docker");
      if (payload.start) await runManager(["start", job.instance], 120000);
      const applied = await applyCreateCapabilities(job.instance, capabilities, "docker");
      return { output: [deploy.stdout, deploy.stderr].filter(Boolean).join("\n"), result: { instance: job.instance, capabilities: applied, messaging: telegramResult } };
    }
    case "start":
    case "stop":
    case "restart":
    case "delete": {
      if (await isNemoClawInstance(job.instance)) {
        const result = await runNemoHermesAction(job.instance, job.action, 120000);
        return { output: [result.stdout, result.stderr].filter(Boolean).join("\n"), result: { instance: job.instance, runtime: "nemoclaw" } };
      }
      const result = await runManager([job.action, job.instance], 120000);
      return { output: [result.stdout, result.stderr].filter(Boolean).join("\n"), result: { instance: job.instance } };
    }
    case "update": {
      updateJob(job.id, { progress: 15 });
      if (await isNemoClawInstance(job.instance)) {
        const result = await withProgressHeartbeat(job.id, 15, 88, () => runNemoHermesAction(job.instance, job.action, BUILD_TIMEOUT_MS));
        updateJob(job.id, { progress: 90 });
        return { output: [result.stdout, result.stderr].filter(Boolean).join("\n"), result: { instance: job.instance, runtime: "nemoclaw" } };
      }
      const result = await withProgressHeartbeat(job.id, 15, 88, () => run(HERMES_DOCKER, ["update", job.instance], {
        jobId: job.id,
        timeout: BUILD_TIMEOUT_MS,
        maxBuffer: 1024 * 1024 * 8,
      }));
      updateJob(job.id, { progress: 90 });
      return { output: [result.stdout, result.stderr].filter(Boolean).join("\n"), result: { instance: job.instance } };
    }
    case "rerun-checks": {
      const names = await discoverInstanceNames();
      return { output: `Checked ${names.length} agents.`, result: { instances: names } };
    }
    case "rebuild-console":
    case "rebuild-camofox-image":
    case "rebuild-hermes-image": {
      const target = job.action.replace("rebuild-", "");
      return { output: `${target} rebuild is queued for manual follow-up in this release.`, result: { target } };
    }
    case "session-chat": {
      const result = await runChatJob(job.instance, payload, job.id);
      const chat = await resolveChatJobResult(job.instance, payload);
      return { output: [result.stdout, result.stderr].filter(Boolean).join("\n"), result: { instance: job.instance, ...chat } };
    }
    case "global-config-sync": {
      const requestedNames = Array.isArray(payload.names)
        ? payload.names.map((name: unknown) => validators.validateName(name)).filter(Boolean)
        : [];
      const scoped = payload.scoped === true || Array.isArray(payload.names);
      const availableNames = await discoverInstanceNames();
      const requestedSet = new Set(requestedNames);
      const names = scoped ? availableNames.filter((name) => requestedSet.has(name)) : availableNames;
      const snapshots = await Promise.all(names.map((name) => instanceSnapshot(name)));
      const restartTargets = snapshots
        .filter((instance) => ["running", "partial"].includes(instance.state))
        .map((instance) => instance.name);
      updateJob(job.id, { progress: 25 });
      const synced = await syncGlobalConfigToInstances(names, { recordFullSync: !scoped });
      const restarted = [];
      for (const [index, name] of restartTargets.entries()) {
        updateJob(job.id, { progress: Math.min(95, 50 + Math.round((index / Math.max(1, restartTargets.length)) * 45)) });
        const result = await isNemoClawInstance(name)
          ? await runNemoHermesAction(name, "restart", 120000)
          : await runManager(["restart", name], 120000);
        restarted.push({
          instance: name,
          output: [result.stdout, result.stderr].filter(Boolean).join("\n"),
        });
      }
      const skipped = names.filter((name) => !restartTargets.includes(name));
      return {
        output: `Synced ${synced.length} agents. Restarted ${restarted.length} running agents.${skipped.length ? ` Skipped ${skipped.length} stopped agents.` : ""}`,
        result: { synced, restarted: restarted.map((item) => ({ instance: item.instance })), skipped },
      };
    }
    case "telegram-setup": {
      const telegram = validators.normalizeCreateTelegramSetup(payload.telegram || payload || {});
      const runtime = await isNemoClawInstance(job.instance) ? "nemoclaw" : "docker";
      const snapshot = await instanceSnapshot(job.instance);
      const shouldRestart = ["running", "partial"].includes(String(snapshot.state || ""));
      updateJob(job.id, { progress: 35 });
      const telegramResult = await applyTelegramSetupToInstance(job.instance, telegram, runtime === "nemoclaw" && shouldRestart ? "nemoclaw" : "docker");
      updateJob(job.id, { progress: 70 });
      if (shouldRestart) {
        const result = runtime === "nemoclaw"
          ? await runNemoHermesAction(job.instance, "restart", 120000)
          : await runManager(["restart", job.instance], 120000);
        return {
          output: [result.stdout, result.stderr, `Telegram connected for ${job.instance}.`].filter(Boolean).join("\n"),
          result: { instance: job.instance, runtime, messaging: telegramResult, restarted: true },
        };
      }
      return {
        output: `Telegram connected for ${job.instance}. Start the agent to load the bot settings.`,
        result: { instance: job.instance, runtime, messaging: telegramResult, restarted: false },
      };
    }
    case "backup-export": {
      const result = await exportBackup(payload as any);
      return { output: `Created backup ${result.archive.path}`, result };
    }
    case "backup-restore": {
      const result = await restoreBackup(payload as any);
      return { output: `Restored ${result.restored.length} agents.`, result };
    }
    case "template-deploy": {
      const result = await runTemplateDeploy(payload as any);
      return { output: `Deployed ${result.instance} from template.`, result };
    }
    case "clone": {
      const result = await cloneInstance(job.instance, payload as any);
      return { output: `Cloned ${job.instance} to ${result.target}.`, result };
    }
    case "fleet-move": {
      return runFleetMove(job, (progress) => updateJob(job.id, { progress }));
    }
    default:
      throw new Error(`Unsupported job action: ${job.action}`);
  }
}

export async function processJobs() {
  if (runnerActive) return;
  runnerActive = true;
  try {
    for (;;) {
      const row = db.prepare("SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1").get();
      if (!row) break;
      const job = { ...rowToJob(row), payloadRaw: parseJson(row.payload_json, {}) };
      updateJob(job.id, { status: "running", progress: Math.max(job.progress, 5), startedAt: nowIso() });
      try {
        const result = await runDockerAction(job);
        updateJob(job.id, { status: "completed", progress: 100, output: result.output, error: "", result: result.result, completedAt: nowIso() });
        if (job.instance) recordEvent(job.instance, "job_completed", `${job.action} completed`, { jobId: job.id });
      } catch (error) {
        updateJob(job.id, { status: "failed", error: jobErrorText(error), completedAt: nowIso() });
      }
    }
  } finally {
    runnerActive = false;
  }
}
