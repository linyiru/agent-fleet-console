import type { Router } from "express";
import { validators } from "../config.ts";
import { createJob } from "../services/jobs.ts";
import {
  captureTemplate,
  checkLocalTemplateRequirements,
  checkTemplateRequirementsForTarget,
  deleteTemplate,
  deployTemplateToRemote,
  getTemplateLibraryItem,
  listTemplateLibrary,
} from "../services/template-library.ts";

function sendError(error: any, next: (error: any) => void, res: any) {
  if (error?.status === 409 && error.details) {
    return res.status(409).json({ error: error.message, requirements: error.details });
  }
  return next(error);
}

export function registerTemplateLibraryRoutes(router: Router) {
  router.get("/template-library", async (_req, res, next) => {
    try {
      res.json(await listTemplateLibrary());
    } catch (error) {
      next(error);
    }
  });

  router.post("/template-library/capture", async (req, res, next) => {
    try {
      res.status(201).json(await captureTemplate({
        sourceName: req.body?.sourceName || req.body?.sourceInstance || "",
        sourceNodeId: req.body?.sourceNodeId || "local",
        name: req.body?.name || "",
        description: req.body?.description || "",
        includeWorkspace: req.body?.includeWorkspace !== false,
      }));
    } catch (error) {
      next(error);
    }
  });

  router.post("/template-library/requirements/check", async (req, res, next) => {
    try {
      res.json(await checkLocalTemplateRequirements(req.body?.requirements || {}));
    } catch (error) {
      next(error);
    }
  });

  router.post("/template-library/archive/deploy", async (req, res, next) => {
    try {
      const archivePath = validators.validateBackupArchivePath(req.body?.archivePath);
      const name = validators.validateName(req.body?.name || "");
      res.status(202).json({
        job: createJob("template-deploy", name, {
          archivePath,
          name,
          start: req.body?.start !== false,
          allowMissingRequirements: req.body?.allowMissingRequirements === true,
        }, req.ip || "local"),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/template-library/:id/requirements/check", async (req, res, next) => {
    try {
      const id = validators.validateTemplateId(req.params.id);
      const targetNodeId = String(req.body?.targetNodeId || "local");
      res.json(await checkTemplateRequirementsForTarget(id, targetNodeId));
    } catch (error) {
      sendError(error, next, res);
    }
  });

  router.post("/template-library/:id/deploy", async (req, res, next) => {
    try {
      const id = validators.validateTemplateId(req.params.id);
      const template = getTemplateLibraryItem(id);
      if (!template) return res.status(404).json({ error: "Template not found" });
      const targetNodeId = String(req.body?.targetNodeId || "local");
      const name = validators.validateName(req.body?.name || "");
      const start = req.body?.start !== false;
      const allowMissingRequirements = req.body?.allowMissingRequirements === true;
      const requirements = await checkTemplateRequirementsForTarget(id, targetNodeId);
      if (!requirements.ok && !allowMissingRequirements) {
        return res.status(409).json({ error: "Template requirements are missing on the target node", requirements });
      }
      if (targetNodeId === "local") {
        return res.status(202).json({
          job: createJob("template-deploy", name, {
            templateId: id,
            archivePath: template.archive.path,
            name,
            start,
            allowMissingRequirements,
          }, req.ip || "local"),
          requirements,
        });
      }
      res.status(202).json(await deployTemplateToRemote(template, { id, name, targetNodeId, start, allowMissingRequirements }));
    } catch (error) {
      sendError(error, next, res);
    }
  });

  router.delete("/template-library/:id", async (req, res, next) => {
    try {
      res.json(await deleteTemplate(req.params.id));
    } catch (error) {
      next(error);
    }
  });
}
