import http from "node:http";
import { createApp } from "./app.ts";
import { AUTH_TOKEN, HOST, PORT, ROOT, validateExposureConfig, validators } from "./config.ts";
import { createTerminalUpgradeHandler } from "./terminal.ts";
import { createFleetTerminalUpgradeHandler } from "./fleet-terminal.ts";
import { upgradeAuthorized } from "./auth.ts";
import { composeArgs, composeFile } from "./services/compose.ts";
import { fileExists } from "./lib/env-file.ts";
import { parseJson, recordEvent } from "./services/records.ts";
import { validateTerminalTicket } from "./services/terminal-tickets.ts";
import { processJobs } from "./services/jobs.ts";

validateExposureConfig();

const app = createApp();
const server = http.createServer(app);

const handleTerminalUpgrade = createTerminalUpgradeHandler({
  ROOT,
  composeArgs,
  composeFile,
  fileExists,
  parseJson,
  recordEvent,
  validateName: validators.validateName,
  validateTerminalTicket,
  upgradeAuthorized,
});
const handleFleetTerminalUpgrade = createFleetTerminalUpgradeHandler();

server.on("upgrade", (req, socket) => {
  Promise.resolve(handleFleetTerminalUpgrade(req, socket)).then((handled) => {
    if (!handled) handleTerminalUpgrade(req, socket);
  }).catch(() => socket.destroy());
});

server.listen(PORT, HOST, () => {
  console.log(`Hermes Fleet Console listening on http://${HOST}:${PORT}`);
  if (AUTH_TOKEN) {
    const base = process.env.HERMES_CONSOLE_DEV_FRONTEND_URL || `http://127.0.0.1:${PORT}`;
    console.log(`Sign in without pasting the token: ${base}/?token=${encodeURIComponent(AUTH_TOKEN)}`);
  }
});

processJobs();
