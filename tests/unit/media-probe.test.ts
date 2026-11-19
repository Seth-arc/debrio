import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authorizeProbe, probeEnabled } from "../../lib/media-probe";
import { POST } from "../../app/api/probe/grant/route";
import { probeRequest } from "../../lib/probe-request";

const credential = "a".repeat(64);
const assignment = {
  hash: createHash("sha256").update(credential).digest("hex"),
  identity: "synthetic-1",
  session: "a",
  room: "main",
  providerRoom: "p101-a-main",
};
const fixture = { expiresAt: 2000, assignments: [assignment] };
afterEach(() => vi.unstubAllEnvs());

describe("P1-01 scoped fixture authorization", () => {
  it("reports unexpected failures without exposing messages, paths or credentials", async () => {
    vi.stubEnv("MEDIA_PROBE_ENABLED", "1");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("MEDIA_PROBE_ORIGIN", "https://example.test");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const code of ["EPERM", "private_fixture_value"]) {
        const result = await probeRequest(
          new Request("https://example.test/api/probe/monitor", {
            method: "POST",
            headers: {
              origin: "https://example.test",
              "content-type": "application/json",
            },
            body: "{}",
          }),
          async () => {
            throw Object.assign(new Error("private_fixture_value"), {
              code,
              syscall: "rename",
              path: "private_fixture_value",
            });
          }
        );
        expect(result.status).toBe(503);
        expect(await result.text()).not.toContain("private_fixture_value");
        expect(log).toHaveBeenLastCalledWith("Local probe operation failed", {
          code: code === "EPERM" ? code : "unknown",
          operation: "rename",
        });
      }
    } finally {
      log.mockRestore();
    }
  });
  it("derives identity server-side and rejects another session/room, invalid or expired invitation", () => {
    expect(
      authorizeProbe(
        { credential, session: "a", room: "main", identity: "admin" },
        fixture,
        1000
      )
    ).toEqual(assignment);
    for (const input of [
      null,
      {},
      { credential: "b".repeat(64), session: "a", room: "main" },
      { credential, session: "b", room: "main" },
      { credential, session: "a", room: "breakout-1" },
      { credential: [], session: "a", room: "main" },
    ]) {
      expect(authorizeProbe(input, fixture, 1000)).toBeUndefined();
    }
    expect(
      authorizeProbe({ credential, session: "a", room: "main" }, fixture, 2000)
    ).toBeUndefined();
  });
  it("is disabled by default and on Vercel", async () => {
    vi.stubEnv("MEDIA_PROBE_ENABLED", "");
    expect(probeEnabled()).toBe(false);
    expect(
      (
        await POST(
          new Request("https://example.test/api/probe/grant", {
            method: "POST",
          })
        )
      ).status
    ).toBe(404);
    vi.stubEnv("MEDIA_PROBE_ENABLED", "1");
    vi.stubEnv("VERCEL", "1");
    expect(probeEnabled()).toBe(false);
  });
  it("bounds request size and rejects cross-origin and malformed requests", async () => {
    vi.stubEnv("MEDIA_PROBE_ORIGIN", "https://example.test");
    vi.stubEnv("MEDIA_PROBE_ENABLED", "1");
    vi.stubEnv("VERCEL", "");
    const request = (body: string, origin = "https://example.test") =>
      new Request("https://example.test/api/probe/grant", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body,
      });
    expect((await POST(request("{}", "https://other.test"))).status).toBe(403);
    expect((await POST(request("x".repeat(1025)))).status).toBe(413);
    expect((await POST(request("{"))).status).toBe(400);
  });
  it("P1-02 disables the original issuer while monitoring notice gates are active", async () => {
    vi.stubEnv("MEDIA_PROBE_ENABLED", "1");
    vi.stubEnv("MEDIA_MONITOR_PROBE", "1");
    expect(
      (
        await POST(
          new Request("http://127.0.0.1/api/probe/grant", { method: "POST" })
        )
      ).status
    ).toBe(404);
  });
});
