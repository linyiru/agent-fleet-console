import type { Router } from "express";
import { validators } from "../config.ts";
import { recordEvent } from "../services/records.ts";
import {
  addSharedEntry,
  deleteSharedEntry,
  linkAgent,
  listSharedEntries,
  searchSharedEntries,
  sharedMemoryStatus,
  startHub,
  stopHub,
  unlinkAgent,
} from "../services/shared-memory.ts";

export function registerSharedMemoryRoutes(router: Router) {
  router.get("/shared-memory", async (_req, res, next) => {
    try {
      res.json(await sharedMemoryStatus());
    } catch (error) {
      next(error);
    }
  });

  router.post("/shared-memory/hub", async (req, res, next) => {
    try {
      const action = String(req.body?.action || "");
      if (action === "start") {
        const state = await startHub();
        recordEvent("", "shared-memory", "Shared memory hub started");
        return res.json(state);
      }
      if (action === "stop") {
        const state = await stopHub();
        recordEvent("", "shared-memory", "Shared memory hub stopped");
        return res.json(state);
      }
      return res.status(400).json({ error: "action must be start or stop" });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/shared-memory/entries", async (req, res, next) => {
    try {
      const query = String(req.query.query || "").trim();
      const limit = Number(req.query.limit || 100);
      res.json(query ? await searchSharedEntries(query, Math.min(limit, 50)) : await listSharedEntries(limit));
    } catch (error) {
      next(error);
    }
  });

  router.post("/shared-memory/entries", async (req, res, next) => {
    try {
      const result = await addSharedEntry(
        String(req.body?.content || ""),
        String(req.body?.kind || "meta"),
        Number(req.body?.importance ?? 0.8),
        "console",
      );
      recordEvent("", "shared-memory", "Shared memory entry added", { memoryId: result?.memory_id || "" });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.delete("/shared-memory/entries/:id", async (req, res, next) => {
    try {
      const result = await deleteSharedEntry(req.params.id);
      recordEvent("", "shared-memory", "Shared memory entry deleted", { memoryId: req.params.id });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/shared-memory/agents/:name/link", async (req, res, next) => {
    try {
      const name = validators.validateName(req.params.name);
      const result = await linkAgent(name);
      recordEvent(name, "shared-memory", "Agent linked to shared memory");
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.delete("/shared-memory/agents/:name/link", async (req, res, next) => {
    try {
      const name = validators.validateName(req.params.name);
      const result = await unlinkAgent(name);
      recordEvent(name, "shared-memory", "Agent unlinked from shared memory");
      res.json(result);
    } catch (error) {
      next(error);
    }
  });
}
