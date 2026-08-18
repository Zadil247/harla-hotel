import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { getEtbToUsdQuote } from "../server/exchange-rate.js";

const root = process.cwd();
const port = Number(process.env.PORT || 4177);
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function json(response, status, body) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

async function exchangeRate(requestUrl, response) {
  const amountEtb = Number(requestUrl.searchParams.get("amount_etb"));
  if (!Number.isFinite(amountEtb) || amountEtb < 1 || amountEtb > 10_000_000) {
    json(response, 400, { error: "Please provide a valid ETB booking total." });
    return;
  }

  try {
    json(response, 200, await getEtbToUsdQuote(amountEtb));
  } catch (error) {
    json(response, Number(error.status) || 503, {
      error:
        error.message ||
        "The exchange-rate provider is temporarily unavailable.",
    });
  }
}

async function staticFile(requestUrl, response) {
  const pathname =
    requestUrl.pathname === "/"
      ? "/index.html"
      : decodeURIComponent(requestUrl.pathname);
  const filePath = resolve(root, `.${pathname}`);

  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) {
      throw new Error("Not a file");
    }
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type":
        contentTypes[extname(filePath).toLowerCase()] ||
        "application/octet-stream",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host}`);

  if (
    request.method === "GET" &&
    requestUrl.pathname === "/api/exchange-rate"
  ) {
    await exchangeRate(requestUrl, response);
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/api/event-confirmation"
  ) {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    const apiRequest = new Request(requestUrl, {
      method: "POST",
      headers: request.headers,
      body,
    });
    const { default: handler } = await import("../api/event-confirmation.js");
    const apiResponse = await handler.fetch(apiRequest);
    response.writeHead(apiResponse.status, Object.fromEntries(apiResponse.headers.entries()));
    response.end(Buffer.from(await apiResponse.arrayBuffer()));
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/api/event-confirmation-email"
  ) {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    const apiRequest = new Request(requestUrl, {
      method: "POST",
      headers: request.headers,
      body,
    });
    const { default: handler } = await import("../api/event-confirmation-email.js");
    const apiResponse = await handler.fetch(apiRequest);
    response.writeHead(apiResponse.status, Object.fromEntries(apiResponse.headers.entries()));
    response.end(Buffer.from(await apiResponse.arrayBuffer()));
    return;
  }

  const eventApiModules = {
    "/api/event-request": "../api/event-request.js",
    "/api/event-portal": "../api/event-portal.js",
    "/api/event-admin": "../api/event-admin.js",
  };
  if (request.method === "POST" && eventApiModules[requestUrl.pathname]) {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    const apiRequest = new Request(requestUrl, {
      method: "POST",
      headers: request.headers,
      body,
    });
    const { default: handler } = await import(eventApiModules[requestUrl.pathname]);
    const apiResponse = await handler.fetch(apiRequest);
    response.writeHead(apiResponse.status, Object.fromEntries(apiResponse.headers.entries()));
    response.end(Buffer.from(await apiResponse.arrayBuffer()));
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Method not allowed");
    return;
  }

  await staticFile(requestUrl, response);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Harla Hotel local preview: http://127.0.0.1:${port}`);
});
