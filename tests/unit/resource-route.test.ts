import { beforeEach, expect, test, vi } from "vitest";
const { rpc, serviceRpc, currentHost, cookie, validate } = vi.hoisted(() => ({
  rpc: vi.fn(),
  serviceRpc: vi.fn(),
  currentHost: vi.fn(),
  cookie: vi.fn(),
  validate: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: cookie }) }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc: serviceRpc }),
}));
vi.mock("../../lib/supabase", () => ({
  currentHost,
  guestSupabase: () => ({ rpc }),
}));
vi.mock("../../lib/resource-link", async (original) => ({
  ...(await original<object>()),
  validateResourceLink: validate,
}));
import { POST } from "../../app/api/resources/route";
import { GET } from "../../app/api/resources/open/route";

const id = "11111111-1111-4111-8111-111111111111";
function request(body: unknown, extra: Record<string, string> = {}) {
  return new Request("http://localhost:3100/api/resources", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3100",
      origin: "http://127.0.0.1:3100",
      "content-type": "application/json",
      ...extra,
    },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: { items: [] }, error: null });
  serviceRpc.mockResolvedValue({ data: { committed: true }, error: null });
  currentHost.mockResolvedValue({ state: "aal2", supabase: { rpc } });
  cookie.mockReturnValue({ value: "synthetic-only" });
  vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:39321");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
});

test("AC1/8: bounded same-origin envelopes distinguish workspace and session without allowing privilege escalation", async () => {
  expect((await POST(request({ workspace: id, host: true }))).status).toBe(200);
  expect(rpc).toHaveBeenLastCalledWith("read_resource_library", {
    p_workspace: id,
    p_resource: null,
    p_offset: 0,
    p_metadata_only: false,
  });
  expect((await POST(request({ session: id, host: false }))).status).toBe(200);
  expect(rpc).toHaveBeenLastCalledWith(
    "read_resources",
    expect.objectContaining({
      p_credential_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_host: false,
    })
  );
  rpc.mockClear();
  for (const body of [
    { workspace: id, host: false },
    { session: id, workspace: id, host: true },
    { session: id, host: null },
    { session: id, host: false, offset: -1 },
    { session: id, host: false, p_credential_hash: "forged" },
    {
      session: id,
      host: false,
      request: { command: "release" },
      operation: id,
    },
    {
      workspace: id,
      host: true,
      operation: id,
      request: { command: "save", content: "\ud800" },
    },
  ])
    expect((await POST(request(body))).status).toBeGreaterThanOrEqual(400);
  expect(
    (
      await POST(
        request(
          { session: id, host: false },
          { origin: "http://foreign.invalid" }
        )
      )
    ).status
  ).toBe(403);
  expect(
    (
      await POST(
        request({ session: id, host: false, padding: "x".repeat(262144) })
      )
    ).status
  ).toBe(413);
  expect(rpc).not.toHaveBeenCalled();
});

test("AC1/11: MFA and current credentials required; known conflict differs from unknown result without echoing private DB errors", async () => {
  currentHost.mockResolvedValue({ state: "aal1" });
  expect((await POST(request({ workspace: id, host: true }))).status).toBe(403);
  cookie.mockReturnValue(undefined);
  expect((await POST(request({ session: id, host: false }))).status).toBe(403);
  currentHost.mockResolvedValue({ state: "aal2", supabase: { rpc } });
  const body = {
    workspace: id,
    host: true,
    operation: id,
    request: {
      command: "save",
      resource: id,
      revision: 0,
      title: "Test",
      kind: "text",
      content: "Synthetic",
    },
  };
  rpc.mockResolvedValue({
    error: { message: "resource_conflict", code: "P0001", details: "SECRET" },
  });
  expect(await (await POST(request(body))).json()).toEqual({
    error: "resource_conflict",
    uncertain: false,
  });
  rpc.mockRejectedValue(Error("private transport details"));
  expect(await (await POST(request(body))).json()).toEqual({
    error: "unavailable",
    uncertain: true,
  });
});

test("AC3: link resolution uses server-authorized saved URL and service-only receipt; browser cannot supply validation evidence", async () => {
  const body = {
    workspace: id,
    host: true,
    request: { command: "check", resource: id, revision: 1 },
  };
  rpc.mockResolvedValue({
    data: { check: id, actor: id, url: "https://example.com/saved" },
    error: null,
  });
  validate.mockResolvedValue({
    finalUrl: "https://example.com/final",
    chainDigest: "a".repeat(64),
  });
  expect(await (await POST(request(body))).json()).toEqual({
    receipt: { committed: true },
  });
  expect(validate).toHaveBeenCalledWith("https://example.com/saved");
  expect(serviceRpc).toHaveBeenLastCalledWith("finish_resource_check", {
    p_check: id,
    p_outcome: "reachable",
    p_digest: "a".repeat(64),
    p_final_url: "https://example.com/final",
    p_actor: id,
  });
  rpc.mockClear();
  serviceRpc.mockClear();
  validate.mockClear();
  expect(
    (
      await POST(
        request({
          ...body,
          request: {
            ...body.request,
            url: "https://attacker.invalid",
            outcome: "reachable",
          },
        })
      )
    ).status
  ).toBe(400);
  expect(validate).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
  rpc.mockResolvedValue({ error: { message: "not_allowed", code: "42501" } });
  await POST(request(body));
  expect(validate).not.toHaveBeenCalled();
  expect(serviceRpc).not.toHaveBeenCalled();
});

test("AC11: preview authority polling returns only the current token and lifetime, never body or recipient metadata", async () => {
  rpc.mockResolvedValue({
    data: {
      token: "a".repeat(64),
      ttl_ms: 1234,
      version: { title: "Private resource", content: "Private body" },
      recipients: [{ name: "Private name" }],
    },
    error: null,
  });
  const response = await POST(
    request({
      session: id,
      host: true,
      request: {
        command: "preview",
        metadataOnly: true,
        proposal: { command: "schedule" },
      },
    })
  );
  expect(await response.json()).toEqual({
    previewAuthority: { token: "a".repeat(64), ttl_ms: 1234 },
  });
  expect(rpc).toHaveBeenCalledWith("resource_preview", {
    p_session: id,
    p_request: { command: "schedule" },
  });
});

test("AC3: failed validation persists a failed receipt; absent service key fails closed before outbound request", async () => {
  const body = {
    workspace: id,
    host: true,
    request: { command: "check", resource: id, revision: 1 },
  };
  rpc.mockResolvedValue({
    data: { check: id, actor: id, url: "https://example.com/saved" },
    error: null,
  });
  validate.mockRejectedValue(Error("private URL failure"));
  expect(await (await POST(request(body))).json()).toEqual({
    error: "resource_check_required",
  });
  expect(serviceRpc).toHaveBeenCalledWith(
    "finish_resource_check",
    expect.objectContaining({
      p_outcome: "failed",
      p_digest: null,
      p_final_url: null,
    })
  );
  validate.mockClear();
  rpc.mockClear();
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  expect((await POST(request(body))).status).toBe(503);
  expect(validate).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});

test("AC8/10: link-out checks current exact allocation and never redirects denied/prefetched/unreleased resources", async () => {
  const url = `http://127.0.0.1:3100/api/resources/open?session=${id}&allocation=${id}&host=false`;
  const detail = {
    allocation: id,
    kind: "link",
    released_at: "2026-11-22T20:00:00Z",
    revoked_at: null,
    content: "https://example.com/public?q=meaningful",
  };
  rpc.mockResolvedValue({ data: { detail, ttl_ms: 5000 }, error: null });
  const response = await GET(new Request(url));
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(detail.content);
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("cache-control")).toBe("no-store");
  for (const d of [
    null,
    { ...detail, revoked_at: "2026-11-22T21:00:00Z" },
    { ...detail, released_at: null },
    { ...detail, content: "javascript:alert(1)" },
  ]) {
    rpc.mockResolvedValue({ data: { detail: d }, error: null });
    expect((await GET(new Request(url))).status).toBe(403);
  }
  rpc.mockClear();
  expect(
    (await GET(new Request(url, { headers: { purpose: "prefetch" } }))).status
  ).toBe(403);
  expect(rpc).not.toHaveBeenCalled();
});
