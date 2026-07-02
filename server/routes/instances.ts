import path from "node:path";
import type { Router } from "express";
import { validators } from "../config.ts";
import { deleteEnvValue, setEnvValue } from "../lib/env-file.ts";
import { createJob } from "../services/jobs.ts";
import { composeFile, homeDir } from "../services/compose.ts";
import { fileExists } from "../lib/env-file.ts";
import { applyProviderConfigToFile } from "../services/templates.ts";
import { credentialSummaries, instanceSnapshot, listInstances } from "../services/instances.ts";
import { setInstanceDisplayName } from "../services/instance-meta.ts";
import { chatRunStatus, prepareChatTurn, sessionMessages, listSessions, stopChatRun } from "../services/sessions.ts";
import { createTerminalTicket } from "../services/terminal-tickets.ts";
import { readPaymentPolicy, writePaymentPolicy } from "../services/payment-policy.ts";
import { readCronEntries } from "../services/crons.ts";
import { gatewayResponseForInstance } from "../services/gateway.ts";
import { codexCliAuthPayload } from "../services/oauth.ts";

function requireRiskConfirmation(action: string, payload: any = {}) {
  if (action === "start") return;
  if (payload?.confirmed || payload?.riskConfirmed || payload?.confirmedRisk || payload?.riskAccepted) return;
  const error = new Error("Risk confirmation required") as Error & { status?: number };
  error.status = 409;
  throw error;
}

export function registerInstanceRoutes(router: Router) {
  router.get("/instances", async (req, res, next) => {
    try {
      res.json({ instances: await listInstances({ refreshVersions: req.query.refreshVersions === "1" }) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/instances", async (req, res, next) => {
    try {
    const name = validators.validateName(req.body?.name || "");
    const runtime = validators.normalizeCreateRuntime(req.body?.runtime || "docker");
    if (runtime === "nemoclaw") validators.validateNemoClawName(name);
    const dependencies = validators.normalizeCreateDependencies(req.body?.dependencies || {});
    const capabilities = validators.normalizeCreateCapabilities(req.body?.capabilities || {});
    if (runtime === "nemoclaw" && capabilities.codexCli) {
      return res.status(400).json({ error: "Codex CLI capability is only supported for Docker Hermes agents." });
    }
    if (runtime === "nemoclaw" && capabilities.sharedMemory) {
      return res.status(400).json({ error: "Shared memory capability is only supported for Docker Hermes agents." });
    }
    if (capabilities.codexCli && !await codexCliAuthPayload()) {
      return res.status(409).json({ error: "Codex CLI capability requires a saved Codex device login in Fleet settings." });
    }
    const contextFiles = validators.normalizeCreateContextFiles(req.body?.contextFiles || {});
    const telegram = validators.normalizeCreateTelegramSetup(req.body?.telegram || {});
    res.status(202).json({ job: createJob("create", name, {
      templateId: req.body?.templateId || "blank",
      start: req.body?.start !== false,
      runtime,
      dependencies,
      capabilities,
      contextFiles,
      telegram,
    }, req.ip || "local") });
    } catch (error) {
      next(error);
    }
  });

  router.get("/instances/:name", async (req, res, next) => {
    try {
      res.json({ instance: await instanceSnapshot(validators.validateName(req.params.name), { refreshVersions: req.query.refreshVersions === "1" }) });
    } catch (error) {
      next(error);
    }
  });

  router.put("/instances/:name/display-name", async (req, res, next) => {
    try {
      const name = validators.validateName(req.params.name);
      setInstanceDisplayName(name, req.body?.displayName ?? "");
      res.json({ instance: await instanceSnapshot(name) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/instances/:name/actions", (req, res, next) => {
    try {
      const name = validators.validateName(req.params.name);
      const action = validators.validateAction(req.body?.action);
      requireRiskConfirmation(action, req.body || {});
      res.status(202).json({ job: createJob(action, name, req.body || {}, req.ip || "local") });
    } catch (error) {
      next(error);
    }
  });

  router.post("/instances/:name/clone", (req, res) => {
    const name = validators.validateName(req.params.name);
    const payload = validators.normalizeCloneOptions(req.body || {});
    res.status(202).json({ job: createJob("clone", name, payload, req.ip || "local") });
  });

  router.post("/instances/:name/telegram", (req, res) => {
    const name = validators.validateName(req.params.name);
    const telegram = validators.normalizeCreateTelegramSetup(req.body?.telegram || req.body || {});
    res.status(202).json({ job: createJob("telegram-setup", name, { telegram }, req.ip || "local") });
  });

  router.get("/instances/:name/gateway", async (req, res, next) => {
    try {
      res.json(await gatewayResponseForInstance(validators.validateName(req.params.name)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/instances/:name/terminal-ticket", (req, res) => {
    const name = validators.validateName(req.params.name);
    const ticket = createTerminalTicket(name);
    res.json({ ticket, wsUrl: `/api/instances/${encodeURIComponent(name)}/terminal?ticket=${encodeURIComponent(ticket)}` });
  });

  router.get("/instances/:name/crons", async (req, res, next) => {
    try {
      res.json(await readCronEntries(validators.validateName(req.params.name)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/instances/:name/sessions", async (req, res, next) => {
    try {
      res.json(await listSessions(validators.validateName(req.params.name), Number(req.query.limit || 20), Number(req.query.offset || 0)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/instances/:name/sessions/:sessionId/messages", async (req, res, next) => {
    try {
      res.json(await sessionMessages(validators.validateName(req.params.name), validators.validateSessionId(req.params.sessionId)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/instances/:name/sessions/chat", async (req, res, next) => {
    try {
      const name = validators.validateName(req.params.name);
      const message = validators.validateChatMessage(req.body?.message || "");
      const sessionId = req.body?.sessionId ? validators.validateSessionId(req.body.sessionId) : "";
      const executionPolicy = req.body?.executionPolicy === "bypass-approvals" ? "bypass-approvals" : "default";
      const turn = await prepareChatTurn(name, { sessionId, message, executionPolicy });
      if (turn.mode === "job") {
        return res.status(202).json({ ...turn, job: createJob("session-chat", name, turn.jobPayload, req.ip || "local") });
      }
      return res.status(202).json(turn);
    } catch (error) {
      next(error);
    }
  });

  router.get("/instances/:name/sessions/runs/:runId", async (req, res, next) => {
    try {
      res.json(await chatRunStatus(validators.validateName(req.params.name), validators.validateSessionId(req.params.runId)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/instances/:name/sessions/runs/:runId/stop", async (req, res, next) => {
    try {
      res.json(await stopChatRun(validators.validateName(req.params.name), validators.validateSessionId(req.params.runId)));
    } catch (error) {
      next(error);
    }
  });

  router.put("/instances/:name/provider", async (req, res, next) => {
    try {
      const name = validators.validateName(req.params.name);
      await applyProviderConfigToFile(path.join(homeDir(name), "config.yaml"), req.body || {});
      res.json({ instance: await instanceSnapshot(name) });
    } catch (error) {
      next(error);
    }
  });

  router.put("/instances/:name/credentials", async (req, res) => {
    const name = validators.validateName(req.params.name);
    const key = validators.validateCredentialKey(req.body?.key);
    await setEnvValue(path.join(homeDir(name), ".env"), key, validators.validateCredentialValue(req.body?.value, key));
    res.json({ ok: true });
  });

  router.delete("/instances/:name/credentials/:key", async (req, res) => {
    const name = validators.validateName(req.params.name);
    await deleteEnvValue(path.join(homeDir(name), ".env"), validators.validateCredentialKey(req.params.key));
    res.json({ ok: true });
  });

  router.get("/instances/:name/credentials", async (req, res) => {
    const name = validators.validateName(req.params.name);
    if (!await fileExists(composeFile(name))) return res.status(404).json({ error: "Instance not found" });
    return res.json(await credentialSummaries(name));
  });

  router.get("/instances/:name/payment-policy", async (req, res) => {
    const name = validators.validateName(req.params.name);
    res.json({ policy: await readPaymentPolicy(name) });
  });

  router.put("/instances/:name/payment-policy", async (req, res, next) => {
    try {
      const name = validators.validateName(req.params.name);
      const policy = await writePaymentPolicy(name, req.body || {});
      res.json({ policy, instance: await instanceSnapshot(name) });
    } catch (error) {
      next(error);
    }
  });
}
