import express from "express";
import path from "node:path";
import fs from "node:fs";
import { APP_ROOT } from "./config.ts";
import { requireConsoleAuth } from "./auth.ts";
import { registerGlobalConfigRoutes } from "./routes/global-config.ts";
import { registerInstanceRoutes } from "./routes/instances.ts";
import { registerSystemRoutes } from "./routes/system.ts";
import { registerBackupRoutes } from "./routes/backups.ts";
import { registerFleetRoutes } from "./routes/fleet.ts";
import { registerSharedMemoryRoutes } from "./routes/shared-memory.ts";
import { registerTelegramRoutes } from "./routes/telegram.ts";
import { registerTemplateLibraryRoutes } from "./routes/template-library.ts";

function requestHostname(requestHost = "") {
  const value = requestHost.trim();
  if (!value) return "";
  try {
    return new URL(`http://${value}`).hostname;
  } catch {
    return value.split(":")[0] || "";
  }
}

export function devFrontendRedirectUrl(devFrontendUrl: string, originalUrl = "/", requestHost = "") {
  const target = new URL(originalUrl || "/", devFrontendUrl);
  const hostname = requestHostname(requestHost);
  if (hostname && !["localhost", "127.0.0.1", "::1"].includes(hostname) && ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(target.hostname)) {
    target.hostname = hostname;
  }
  return target.toString();
}

export function createApp() {
  const app = express();
  const router = express.Router();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", requireConsoleAuth);

  registerSystemRoutes(router);
  registerFleetRoutes(router);
  registerBackupRoutes(router);
  registerTemplateLibraryRoutes(router);
  registerGlobalConfigRoutes(router);
  registerInstanceRoutes(router);
  registerSharedMemoryRoutes(router);
  registerTelegramRoutes(router);
  app.use("/api", router);

  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status || 500).json({ error: error.message || "Server error" });
  });

  const devFrontendUrl = process.env.HERMES_CONSOLE_DEV_FRONTEND_URL;
  if (devFrontendUrl) {
    app.get(/.*/, (req, res) => {
      res.redirect(devFrontendRedirectUrl(devFrontendUrl, req.originalUrl || "/", req.get("host") || ""));
    });
    return app;
  }

  const dist = path.join(APP_ROOT, "dist");
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }
  return app;
}
