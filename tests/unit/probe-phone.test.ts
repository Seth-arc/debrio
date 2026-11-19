import { createServer, request } from "node:http";
import { once } from "node:events";
import { expect, it, vi } from "vitest";
import { phoneProxy } from "../../lib/probe-phone";

it("phone endpoint forwards only scoped requests and denies origin/path/size/expiry attacks", async () => {
  let calls = 0;
  const app = createServer((_, response) => {
    calls++;
    response.end("synthetic");
  });
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  const address = app.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test port");
  let origin = "https://test.trycloudflare.com";
  const expiresAt = Date.now() + 60000;
  const proxy = phoneProxy(() => origin, expiresAt, address.port);
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");
  const listening = proxy.address();
  if (!listening || typeof listening === "string")
    throw new Error("Missing test port");
  const url = `http://127.0.0.1:${listening.port}`;
  const headers = {
    host: "test.trycloudflare.com",
    origin,
    "content-type": "application/json",
  };
  const fetch = (
    url: string,
    options: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    } = {}
  ) =>
    new Promise<{ status: number; text: () => Promise<string> }>(
      (resolve, reject) => {
        const req = request(url, options, (response) => {
          let body = "";
          response.on("data", (chunk) => {
            body += chunk;
          });
          response.on("end", () =>
            resolve({ status: response.statusCode!, text: async () => body })
          );
        });
        req.on("error", reject);
        req.end(options.body);
      }
    );
  try {
    expect(
      await (await fetch(url + "/probe/monitor", { headers })).text()
    ).toBe("synthetic");
    expect(
      (
        await fetch(url + "/api/probe/monitor", {
          method: "POST",
          headers,
          body: "{}",
        })
      ).status
    ).toBe(200);
    expect((await fetch(url + "/.env.local", { headers })).status).toBe(404);
    expect((await fetch(url + "/api/probe/grant", { headers })).status).toBe(
      404
    );
    expect(
      (
        await fetch(url + "/api/probe/monitor", {
          method: "POST",
          headers: { ...headers, origin: "https://other.example" },
          body: "{}",
        })
      ).status
    ).toBe(403);
    expect((await fetch(url + "/probe/monitor")).status).toBe(403);
    expect(
      (
        await fetch(url + "/api/probe/monitor", {
          method: "POST",
          headers,
          body: "x".repeat(16385),
        })
      ).status
    ).toBe(413);
    expect(
      (
        await fetch(url + "/api/probe/monitor", {
          method: "POST",
          headers,
          body: JSON.stringify({ action: "save", text: "漢".repeat(2000) }),
        })
      ).status
    ).toBe(200);
    const clock = vi.spyOn(Date, "now").mockReturnValue(expiresAt);
    expect((await fetch(url + "/probe/monitor", { headers })).status).toBe(410);
    clock.mockRestore();
    origin = "";
    expect((await fetch(url + "/probe/monitor", { headers })).status).toBe(410);
    expect(calls).toBe(3);
  } finally {
    vi.restoreAllMocks();
    proxy.closeAllConnections();
    app.closeAllConnections();
    await Promise.all([
      new Promise<void>((resolve) => proxy.close(() => resolve())),
      new Promise<void>((resolve) => app.close(() => resolve())),
    ]);
  }
});
