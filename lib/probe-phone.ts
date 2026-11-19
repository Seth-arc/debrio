import { createServer, request } from "node:http";

// Temporary synthetic fixture only. Never proxy the application root or admin APIs.
export function phoneProxy(
  origin: () => string,
  expiresAt: number,
  port = 3101
) {
  const server = createServer(async (incoming, outgoing) => {
    outgoing.setHeader("Cache-Control", "no-store");
    const reject = (status: number) => {
      outgoing.writeHead(status);
      outgoing.end();
    };
    const expected = origin();
    if (!expected || Date.now() >= expiresAt) return reject(410);
    if (incoming.headers.host !== new URL(expected).host) return reject(403);
    const path = incoming.url ?? "";
    const read =
      incoming.method === "GET" &&
      (path === "/probe/monitor" ||
        /^\/_next\/static\/[a-zA-Z0-9_./-]+$/.test(path));
    const write = incoming.method === "POST" && path === "/api/probe/monitor";
    if ((!read && !write) || path.includes("..")) return reject(404);
    if (
      write &&
      (incoming.headers.origin !== expected ||
        incoming.headers["content-type"] !== "application/json")
    )
      return reject(403);
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of incoming) {
        size += chunk.length;
        if (size > 4096) return reject(413);
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      const upstream = request(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method: incoming.method,
          headers: {
            host: "127.0.0.1:3101",
            origin: expected,
            "content-type": "application/json",
            "content-length": body.length,
          },
          timeout: 6000,
        },
        (response) => {
          outgoing.writeHead(response.statusCode ?? 502, {
            ...response.headers,
            "cache-control": "no-store",
          });
          response.pipe(outgoing);
        }
      );
      upstream.on("timeout", () => upstream.destroy());
      upstream.on("error", () => {
        if (!outgoing.headersSent) reject(502);
        else outgoing.destroy();
      });
      outgoing.on("close", () => upstream.destroy());
      upstream.end(body);
    } catch {
      if (!outgoing.headersSent) reject(400);
    }
  });
  server.requestTimeout = 8000;
  server.headersTimeout = 8000;
  server.maxConnections = 20;
  return server;
}
