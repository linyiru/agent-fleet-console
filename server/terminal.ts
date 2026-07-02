import crypto from "node:crypto";
import { spawn } from "node:child_process";

function parseWebSocketFrames(buffer, onText, onClose) {
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    let length = second & 0x7f;
    let headerLength = 2;
    if (length === 126) {
      if (buffer.length - offset < 4) break;
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (buffer.length - offset < 10) break;
      length = buffer.readUInt32BE(offset + 2) * 2 ** 32 + buffer.readUInt32BE(offset + 6);
      headerLength = 10;
    }
    const masked = Boolean(second & 0x80);
    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + length;
    if (buffer.length - offset < frameLength) break;
    if (opcode === 0x8) onClose();
    if (opcode === 0x1) {
      const mask = masked ? buffer.subarray(offset + headerLength, offset + headerLength + 4) : null;
      const start = offset + headerLength + maskLength;
      const payload = Buffer.from(buffer.subarray(start, start + length));
      if (mask) {
        for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
      }
      onText(payload.toString("utf8"));
    }
    offset += frameLength;
  }
  return buffer.subarray(offset);
}

function webSocketSend(socket, payload) {
  if (socket.destroyed) return;
  const body = Buffer.from(JSON.stringify(payload));
  let header;
  if (body.length < 126) {
    header = Buffer.from([0x81, body.length]);
  } else if (body.length < 65536) {
    header = Buffer.from([0x81, 126, body.length >> 8, body.length & 0xff]);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(body.length, 6);
  }
  socket.write(Buffer.concat([header, body]));
}

function webSocketClose(socket) {
  if (!socket.destroyed) socket.end(Buffer.from([0x88, 0x00]));
}

function terminalCommandArgs(composeArgs, name, cols, rows) {
  const shell = [
    "export HOME=/opt/data HERMES_HOME=/opt/data TERM=xterm-256color COLORTERM=truecolor",
    `export COLUMNS=${cols} LINES=${rows}`,
    `stty cols ${cols} rows ${rows} 2>/dev/null || true`,
    "cd /opt/data/workspace 2>/dev/null || cd /opt/data",
    "export PATH=/opt/data/bin:/opt/data/.npm-global/bin:/opt/hermes/.venv/bin:$PATH",
    "printf '\\033[1;36mHermes container shell\\033[0m  %s\\n' \"$HOSTNAME\"",
    "printf 'Home: %s  Workspace: %s\\n' \"$HERMES_HOME\" \"$PWD\"",
    "printf 'Try: hermes status, hermes update, hermes setup, hermes auth\\n\\n'",
    "if command -v bash >/dev/null 2>&1; then exec bash -i; else exec sh; fi",
  ].join("; ");
  return [...composeArgs(name, "exec", "-T", "hermes", "script", "-q", "-c", shell, "/dev/null")];
}

export function createTerminalUpgradeHandler(ctx) {
  return async function handleTerminalUpgrade(req, socket) {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const match = url.pathname.match(/^\/api\/instances\/([^/]+)\/terminal$/);
    if (!match) return socket.destroy();
    try {
      const name = ctx.validateName(decodeURIComponent(match[1]));
      if (!ctx.upgradeAuthorized(req, url)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        return socket.destroy();
      }
      if (!ctx.validateTerminalTicket(name, url.searchParams.get("ticket") || "")) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        return socket.destroy();
      }
      if (!await ctx.fileExists(ctx.composeFile(name))) {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        return socket.destroy();
      }
      const cols = Math.min(Math.max(Number(url.searchParams.get("cols") || 120), 40), 240);
      const rows = Math.min(Math.max(Number(url.searchParams.get("rows") || 36), 12), 80);
      const key = req.headers["sec-websocket-key"];
      if (!key) {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        return socket.destroy();
      }
      const accept = crypto.createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
      socket.write(["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${accept}`, "", ""].join("\r\n"));
      const child = spawn("docker", terminalCommandArgs(ctx.composeArgs, name, cols, rows), {
        cwd: ctx.ROOT,
        env: { ...process.env, TERM: "xterm-256color" },
        stdio: ["pipe", "pipe", "pipe"],
      });
      ctx.recordEvent(name, "terminal_opened", `Terminal opened for ${name}`, { cols, rows });
      webSocketSend(socket, { type: "status", status: "connected", instance: name });
      child.stdout.on("data", (chunk) => webSocketSend(socket, { type: "output", data: chunk.toString("utf8") }));
      child.stderr.on("data", (chunk) => webSocketSend(socket, { type: "output", data: chunk.toString("utf8") }));
      child.on("close", (code, signal) => {
        webSocketSend(socket, { type: "status", status: "closed", code, signal });
        webSocketClose(socket);
        ctx.recordEvent(name, "terminal_closed", `Terminal closed for ${name}`, { code, signal });
      });
      let frameBuffer = Buffer.alloc(0);
      const cleanup = () => { if (!child.killed) child.kill("SIGTERM"); };
      socket.on("data", (chunk) => {
        frameBuffer = parseWebSocketFrames(Buffer.concat([frameBuffer, chunk]), (text) => {
          const message = ctx.parseJson(text, {});
          if (message.type === "input" && typeof message.data === "string") child.stdin.write(message.data);
        }, cleanup);
      });
      socket.on("close", cleanup);
      socket.on("error", cleanup);
    } catch (error) {
      socket.write(`HTTP/1.1 ${error.status || 500} Terminal Error\r\n\r\n`);
      socket.destroy();
    }
  };
}
