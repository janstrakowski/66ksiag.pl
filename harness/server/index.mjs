import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HARNESS_PORT,
  MAIN_PREVIEW_PORT,
  ensureHarnessLayout,
  REPO_ROOT,
} from "./paths.mjs";
import { ensureMainCheckout, branchExists, git } from "./git.mjs";
import {
  listTickets,
  getTicket,
  createTicket,
  updateTicketMeta,
  ticketExists,
} from "./tickets.mjs";
import {
  startMainPreview,
  startTicketPreview,
  registerTicketPreview,
  stopPreview,
  getPreview,
  listPreviews,
  stopAllPreviews,
} from "./preview.mjs";
import {
  sendPrompt,
  stopAgent,
  isRunning,
  subscribe,
  REQUEST_PREVIEW_PROMPT,
} from "./agent.mjs";
import { listDir, readFile } from "./files.mjs";
import { startAndroidTest, androidStatus, subscribeAndroid } from "./android.mjs";
import { mergeTicketToMain, mergeMainToProd } from "./merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, "../web");

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sse(res) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  res.write(":\n\n");
  const send = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  return send;
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".svg": "image/svg+xml",
      ".json": "application/json",
    }[ext] || "application/octet-stream"
  );
}

function serveStatic(req, res, urlPath) {
  let rel = urlPath === "/" ? "/index.html" : urlPath;
  rel = decodeURIComponent(rel.split("?")[0]);
  const abs = path.normalize(path.join(WEB_ROOT, rel));
  if (!abs.startsWith(WEB_ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  res.writeHead(200, { "content-type": contentType(abs) });
  fs.createReadStream(abs).pipe(res);
}

async function handleApi(req, res, url) {
  const { pathname, searchParams } = url;

  if (req.method === "GET" && pathname === "/api/status") {
    let mainSha = null;
    let prodSha = null;
    try {
      if (branchExists("main")) mainSha = git(["rev-parse", "main"]).stdout;
      if (branchExists("prod")) prodSha = git(["rev-parse", "prod"]).stdout;
    } catch {
      /* ignore */
    }
    return json(res, 200, {
      ok: true,
      harnessPort: HARNESS_PORT,
      mainPreview: getPreview("main") || {
        url: `http://127.0.0.1:${MAIN_PREVIEW_PORT}/`,
        port: MAIN_PREVIEW_PORT,
      },
      previews: listPreviews(),
      mainSha,
      prodSha,
      android: androidStatus(),
      repo: REPO_ROOT,
    });
  }

  if (req.method === "GET" && pathname === "/api/tickets") {
    return json(res, 200, listTickets());
  }

  if (req.method === "POST" && pathname === "/api/tickets") {
    const body = await readBody(req);
    const meta = createTicket(body.id, body.title || "");
    return json(res, 201, meta);
  }

  const ticketMatch = pathname.match(/^\/api\/tickets\/([^/]+)(.*)$/);
  if (ticketMatch) {
    const id = decodeURIComponent(ticketMatch[1]);
    const rest = ticketMatch[2] || "";

    if (!ticketExists(id)) {
      return json(res, 404, { error: "Ticket not found" });
    }

    if (req.method === "GET" && rest === "") {
      return json(res, 200, getTicket(id));
    }

    if (req.method === "POST" && rest === "/prompt") {
      const body = await readBody(req);
      if (!body.prompt || !String(body.prompt).trim()) {
        return json(res, 400, { error: "prompt required" });
      }
      const result = sendPrompt(id, String(body.prompt));
      return json(res, 200, result);
    }

    if (req.method === "POST" && rest === "/stop") {
      const ok = stopAgent(id);
      return json(res, 200, { ok, running: isRunning(id) });
    }

    if (req.method === "POST" && rest === "/request-preview") {
      const prompt = REQUEST_PREVIEW_PROMPT.replaceAll("<TICKET_ID>", id);
      const result = sendPrompt(id, prompt, { system: false });
      return json(res, 200, result);
    }

    if (req.method === "POST" && rest === "/preview") {
      const body = await readBody(req);
      let preview;
      if (body.start) {
        preview = startTicketPreview(id, body.port ? Number(body.port) : undefined);
      } else if (body.port) {
        preview = registerTicketPreview(id, Number(body.port));
      } else {
        return json(res, 400, { error: "port or start required" });
      }
      updateTicketMeta(id, {
        previewUrl: preview.url,
        previewPort: preview.port,
      });
      return json(res, 200, preview);
    }

    if (req.method === "DELETE" && rest === "/preview") {
      stopPreview(id);
      updateTicketMeta(id, { previewUrl: null, previewPort: null });
      return json(res, 200, { ok: true });
    }

    if (req.method === "GET" && rest === "/events") {
      const send = sse(res);
      send({ type: "hello", running: isRunning(id) });
      const unsub = subscribe(id, send);
      const keep = setInterval(() => res.write(":\n\n"), 15000);
      req.on("close", () => {
        clearInterval(keep);
        unsub();
      });
      return;
    }

    if (req.method === "POST" && rest === "/merge") {
      try {
        const result = mergeTicketToMain(id);
        return json(res, 200, result);
      } catch (err) {
        return json(res, err.mergeFailed ? 409 : 400, {
          error: err.message,
          mergeFailed: !!err.mergeFailed,
        });
      }
    }

    if (req.method === "POST" && rest === "/android") {
      try {
        const result = startAndroidTest({ scope: "ticket", ticketId: id });
        return json(res, 200, result);
      } catch (err) {
        return json(res, 409, { error: err.message });
      }
    }
  }

  if (req.method === "GET" && pathname === "/api/files") {
    const scope = searchParams.get("scope") || "main";
    const ticketId = searchParams.get("ticket") || undefined;
    const rel = searchParams.get("path") || ".";
    try {
      return json(res, 200, listDir(scope, ticketId, rel));
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (req.method === "GET" && pathname === "/api/file") {
    const scope = searchParams.get("scope") || "main";
    const ticketId = searchParams.get("ticket") || undefined;
    const rel = searchParams.get("path");
    if (!rel) return json(res, 400, { error: "path required" });
    try {
      return json(res, 200, readFile(scope, ticketId, rel));
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (req.method === "POST" && pathname === "/api/main/promote") {
    try {
      const result = mergeMainToProd();
      return json(res, 200, result);
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (req.method === "POST" && pathname === "/api/main/android") {
    try {
      const result = startAndroidTest({ scope: "main" });
      return json(res, 200, result);
    } catch (err) {
      return json(res, 409, { error: err.message });
    }
  }

  if (req.method === "GET" && pathname === "/api/android/events") {
    const send = sse(res);
    send({ type: "hello", ...androidStatus() });
    const unsub = subscribeAndroid(send);
    const keep = setInterval(() => res.write(":\n\n"), 15000);
    req.on("close", () => {
      clearInterval(keep);
      unsub();
    });
    return;
  }

  return json(res, 404, { error: "Not found" });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://127.0.0.1:${HARNESS_PORT}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: err.message || String(err) });
  }
});

function shutdown() {
  console.log("\nShutting down harness…");
  stopAllPreviews();
  server.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

ensureHarnessLayout();
ensureMainCheckout();
try {
  startMainPreview();
  console.log(`main preview: http://127.0.0.1:${MAIN_PREVIEW_PORT}/`);
} catch (err) {
  console.warn("Could not start main preview:", err.message);
}

server.listen(HARNESS_PORT, "127.0.0.1", () => {
  console.log(`harness: http://127.0.0.1:${HARNESS_PORT}/`);
  try {
    console.log(`main=${branchExists("main") ? git(["rev-parse", "--short", "main"]).stdout : "?"} prod=${branchExists("prod") ? git(["rev-parse", "--short", "prod"]).stdout : "?"}`);
  } catch {
    /* ignore */
  }
});
