import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { createServer, request, type RequestOptions } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isPublicResourceAddress,
  normalizeResourceUrl,
  resourceUrlDigest,
  validateResourceLink,
} from "../../lib/resource-link";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("node:https", async (original) => ({
  ...(await original<typeof import("node:https")>()),
  request: vi.fn(),
}));
const nativeHttps =
  await vi.importActual<typeof import("node:https")>("node:https");
const dnsLookup = vi.mocked(
  lookup as (
    host: string,
    options: { all: true; verbatim: true }
  ) => Promise<{ address: string; family: number }[]>
);

const publicAddress = "93.184.216.34";
type ResponseFixture = {
  status?: number;
  location?: string;
  body?: Buffer;
  remoteAddress?: string;
  authorized?: boolean;
  error?: Error;
  hang?: boolean;
};
let responses: ResponseFixture[];
let requests: RequestOptions[];

function fakeRequest(
  options: RequestOptions,
  callback: (response: IncomingMessage) => void
) {
  requests.push(options);
  const fixture = responses.shift() ?? {};
  const req = new EventEmitter() as ClientRequest;
  let destroyed = false;
  req.destroy = (error?: Error) => {
    destroyed = true;
    queueMicrotask(() => req.emit("error", error));
    return req;
  };
  req.end = (() => {
    queueMicrotask(() => {
      if (fixture.hang) return;
      if (fixture.error) {
        req.destroy(fixture.error);
        return;
      }
      const res = Readable.from([
        fixture.body ?? Buffer.from("Brief"),
      ]) as IncomingMessage;
      Object.assign(res, {
        statusCode: fixture.status ?? 200,
        headers: { location: fixture.location },
        socket: {
          authorized: fixture.authorized ?? true,
          remoteAddress: fixture.remoteAddress ?? publicAddress,
        },
      });
      callback(res);
      if (destroyed) res.destroy();
    });
    return req;
  }) as typeof req.end;
  options.signal?.addEventListener(
    "abort",
    () => req.destroy(new Error("aborted")),
    { once: true }
  );
  return req;
}

beforeEach(() => {
  responses = [];
  requests = [];
  dnsLookup.mockResolvedValue([{ address: publicAddress, family: 4 }]);
  vi.mocked(request).mockImplementation(fakeRequest as typeof request);
});
afterEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
});

describe("resource URL boundary", () => {
  it("canonicalizes the public ASCII host and preserves path, query and fragment", () => {
    expect(
      normalizeResourceUrl(
        "https://EXAMPLE.org:443/a%20b?q=two%20words#section"
      )
    ).toBe("https://example.org/a%20b?q=two%20words#section");
    expect(resourceUrlDigest("https://example.org/")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("refuses schemes, credentials, IP spellings, internal and ambiguous names", () => {
    for (const url of [
      "http://example.org",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "https://user:secret@example.org",
      "https://example.org:444",
      "https://127.0.0.1",
      "https://2130706433",
      "https://0x7f000001",
      "https://[::1]",
      "https://[2001:4860:4860::8888]",
      "https://localhost",
      "https://metadata.google.internal",
      "https://service.local",
      "https://example.org.",
      "https://%65xample.org",
      "https://example.org\\@localhost/",
      "https:////example.org",
      "https://exаmple.org",
      "https://bad_name.org",
      "https://-bad.org",
      "https://bad-.org",
      "https://example.org\n/private",
      "https://example.org/\ud800",
      "https://example.org/" + "x".repeat(2048),
    ])
      expect(() => normalizeResourceUrl(url), url).toThrow("invalid_link");
  });

  it("excludes private, reserved, multicast and translation addresses", () => {
    for (const address of [
      "0.0.0.0",
      "10.1.2.3",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.31.255.255",
      "192.168.1.1",
      "192.0.0.9",
      "192.0.2.1",
      "192.88.99.1",
      "198.18.0.1",
      "198.51.100.2",
      "203.0.113.5",
      "224.0.0.1",
      "255.255.255.255",
      "::",
      "::1",
      "fe80::1",
      "fc00::1",
      "::ffff:127.0.0.1",
      "::ffff:8.8.8.8",
      "64:ff9b::808:808",
      "2001::1",
      "2001:db8::1",
      "2001:4860:4860::8888%eth0",
      "2002:0808:0808::1",
      "3fff::1",
      "not-an-ip",
    ])
      expect(isPublicResourceAddress(address), address).toBe(false);
    for (const address of [
      "8.8.8.8",
      publicAddress,
      "172.32.0.1",
      "2001:4860:4860::8888",
      "2606:4700:4700::1111",
    ])
      expect(isPublicResourceAddress(address), address).toBe(true);
  });
});

describe("bounded anonymous link checks", () => {
  it("pins DNS and TLS, sends no credentials, and does not call a 2xx login page sign-in-free", async () => {
    responses.push({
      body: Buffer.from("<form>Sign in to view this brief</form>"),
    });
    const result = await validateResourceLink(
      "https://example.org/private?q=synthetic#part"
    );
    expect(result).toMatchObject({
      url: "https://example.org/private?q=synthetic#part",
      status: 200,
    });
    expect(Object.keys(result).sort()).toEqual([
      "chainDigest",
      "checkedAt",
      "finalUrl",
      "status",
      "url",
      "urlDigest",
    ]);
    expect(requests[0]).toMatchObject({
      hostname: "example.org",
      servername: "example.org",
      port: 443,
      rejectUnauthorized: true,
      agent: false,
      method: "GET",
      path: "/private?q=synthetic",
      maxHeaderSize: 16384,
      headers: { Accept: "*/*", "Accept-Encoding": "identity" },
    });
    const callback = vi.fn();
    requests[0].lookup!("example.org", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, publicAddress, 4);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(result.urlDigest).toBe(resourceUrlDigest(result.url));
  });

  it("rejects mixed/private DNS answers before making any request", async () => {
    for (const addresses of [
      [
        { address: publicAddress, family: 4 },
        { address: "10.0.0.1", family: 4 },
      ],
      [{ address: "::ffff:127.0.0.1", family: 6 }],
      [],
    ]) {
      dnsLookup.mockResolvedValueOnce(addresses);
      await expect(
        validateResourceLink("https://example.org/")
      ).rejects.toThrow("blocked_link");
    }
    expect(request).not.toHaveBeenCalled();
  });

  it("checks the connected socket address and TLS authorization", async () => {
    responses.push({ remoteAddress: "127.0.0.1" });
    await expect(validateResourceLink("https://example.org/")).rejects.toThrow(
      "blocked_link"
    );
    responses.push({ authorized: false });
    await expect(validateResourceLink("https://example.org/")).rejects.toThrow(
      "blocked_link"
    );
  });

  it("validates every redirect and bounds redirects and cumulative bodies", async () => {
    responses.push({ status: 302, location: "/next" }, { status: 200 });
    const result = await validateResourceLink("https://example.org/");
    expect(result.finalUrl).toBe("https://example.org/next");
    expect(lookup).toHaveBeenCalledTimes(2);
    responses.push({ status: 302, location: "https://%65xample.org/" });
    await expect(validateResourceLink("https://example.org/")).rejects.toThrow(
      "invalid_link"
    );
    responses.push({ status: 302, location: "https://other.org/" });
    dnsLookup
      .mockResolvedValueOnce([{ address: publicAddress, family: 4 }])
      .mockResolvedValueOnce([{ address: "10.0.0.1", family: 4 }]);
    await expect(validateResourceLink("https://example.org/")).rejects.toThrow(
      "blocked_link"
    );
    responses.push(
      ...Array.from({ length: 4 }, () => ({ status: 302, location: "/again" }))
    );
    await expect(validateResourceLink("https://example.org/")).rejects.toThrow(
      "link_redirect_limit"
    );
    responses.push(
      { status: 302, location: "/next", body: Buffer.alloc(40_000) },
      { body: Buffer.alloc(30_000) }
    );
    await expect(validateResourceLink("https://example.org/")).rejects.toThrow(
      "link_too_large"
    );
  });

  it("blocks unauthorized statuses and sanitizes transport failures", async () => {
    for (const status of [401, 403, 404, 500]) {
      responses.push({ status });
      await expect(
        validateResourceLink("https://example.org/")
      ).rejects.toThrow("link_failed");
    }
    responses.push({
      error: new Error("https://secret.example.org/?password=do-not-log"),
    });
    await expect(validateResourceLink("https://example.org/")).rejects.toThrow(
      /^link_failed$/
    );
  });

  it("bounds DNS time in the same ten-second deadline", async () => {
    vi.useFakeTimers();
    dnsLookup.mockImplementationOnce(() => new Promise(() => {}));
    const check = expect(
      validateResourceLink("https://example.org/")
    ).rejects.toThrow("link_timeout");
    await vi.advanceTimersByTimeAsync(10_001);
    await check;
    expect(request).not.toHaveBeenCalled();
  });

  it("also aborts a pending HTTP response at the total deadline", async () => {
    vi.useFakeTimers();
    responses.push({ hang: true });
    const check = expect(
      validateResourceLink("https://example.org/")
    ).rejects.toThrow("link_timeout");
    await vi.advanceTimersByTimeAsync(10_001);
    await check;
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("verifies real TLS certificates and hostname before accepting a bounded response", async () => {
    // Local test transport only: production has no resolver/TLS override.
    const folder = mkdtempSync(join(tmpdir(), "debrio-resource-tls-"));
    const keyPath = join(folder, "key.pem"),
      certPath = join(folder, "cert.pem");
    const openssl =
      process.platform === "win32"
        ? "C:/Program Files/Git/usr/bin/openssl.exe"
        : "openssl";
    execFileSync(
      openssl,
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=example.org",
        "-addext",
        "subjectAltName=DNS:example.org",
        "-keyout",
        keyPath,
        "-out",
        certPath,
      ],
      { stdio: "ignore" }
    );
    // Generated in this test's private temporary directory, never user supplied.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const cert = readFileSync(certPath);
    const server = createServer(
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      { key: readFileSync(keyPath), cert },
      (_req, res) => res.end("Synthetic TLS brief")
    );
    try {
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve)
      );
      const address = server.address();
      if (!address || typeof address === "string")
        throw Error("Missing test listener");
      vi.mocked(request).mockImplementation(((
        options: RequestOptions,
        callback: (res: IncomingMessage) => void
      ) => {
        expect(options.rejectUnauthorized).toBe(true);
        return nativeHttps.request(
          { ...options, hostname: "127.0.0.1", port: address.port, ca: cert },
          (res) => {
            // Keep the real TLS handshake; simulate only the already tested public socket address.
            Object.defineProperty(res.socket, "remoteAddress", {
              value: publicAddress,
            });
            callback(res);
          }
        );
      }) as typeof request);
      await expect(
        validateResourceLink("https://example.org/")
      ).resolves.toMatchObject({ status: 200 });
      await expect(validateResourceLink("https://other.org/")).rejects.toThrow(
        "link_failed"
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(folder, { recursive: true, force: true });
    }
  }, 15_000);
});
