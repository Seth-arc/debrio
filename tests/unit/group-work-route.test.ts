import { beforeEach, expect, test, vi } from "vitest";
const { rpc, currentHost, cookie } = vi.hoisted(() => ({
  rpc: vi.fn(),
  currentHost: vi.fn(),
  cookie: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: cookie }) }));
vi.mock("../../lib/supabase", () => ({
  currentHost,
  guestSupabase: () => ({ rpc }),
}));
import { POST } from "../../app/api/group-work/route";

const session = "11111111-1111-4111-8111-111111111111";
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3100/api/group-work", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3100",
      origin: "http://127.0.0.1:3100",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: { items: [] }, error: null });
  cookie.mockReturnValue({ value: "synthetic-private-cookie" });
  currentHost.mockResolvedValue({ state: "aal2", supabase: { rpc } });
});
test("AC2/3: same incoming host accepted despite internal URL; foreign/null origins and oversize bodies rejected before RPC", async () => {
  expect((await POST(request({ session, host: false }))).status).toBe(200);
  expect(rpc).toHaveBeenCalledWith(
    "read_group_work",
    expect.objectContaining({
      p_host: false,
      p_credential_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
  );
  rpc.mockClear();
  for (const origin of [
    "null",
    "http://attacker.invalid",
    "http://127.0.0.1:3101",
  ])
    expect(
      (await POST(request({ session, host: false }, { origin }))).status
    ).toBe(403);
  expect(
    (await POST(request({ session, host: false, padding: "x".repeat(262144) })))
      .status
  ).toBe(413);
  expect(rpc).not.toHaveBeenCalled();
});
test("AC2/3: cookie and current host MFA required; malformed Unicode and reason types never reach RPC", async () => {
  cookie.mockReturnValue(undefined);
  expect((await POST(request({ session, host: false }))).status).toBe(403);
  currentHost.mockResolvedValue({ state: "aal1" });
  expect((await POST(request({ session, host: true }))).status).toBe(403);
  cookie.mockReturnValue({ value: "synthetic" });
  for (const change of [
    { reason: {} },
    { reason: "", content: { f1: "\ud800" } },
    { reason: "", content: { f1: "\0" } },
    { reason: "", value: "\ud800" },
    { reason: "", value: "\0" },
  ])
    expect(
      (
        await POST(
          request({
            session,
            host: false,
            operation: session,
            request: { command: "contribute", ...change },
          })
        )
      ).status
    ).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});
test("AC5: transport failure remains uncertain; database refusals are known and private details are not echoed", async () => {
  const body = {
    session,
    host: false,
    operation: session,
    request: { command: "contribute", reason: "" },
  };
  rpc.mockResolvedValue({
    data: null,
    error: {
      code: "P0001",
      message: "group_work_conflict",
      details: "private text must never leak",
    },
  });
  expect(await (await POST(request(body))).json()).toEqual({
    error: "group_work_conflict",
    uncertain: false,
  });
  rpc.mockRejectedValue(new Error("transport lost after commit"));
  expect(await (await POST(request(body))).json()).toEqual({
    error: "unavailable",
    uncertain: true,
  });
});

test("AC11: an Auth outage stays retryable and recovery resumes authorized reads", async () => {
  currentHost.mockResolvedValue({ state: "unavailable" });
  const response = await POST(request({ session, host: true }));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: "unavailable",
    uncertain: false,
  });
  expect(rpc).not.toHaveBeenCalled();
  currentHost.mockResolvedValue({ state: "aal2", supabase: { rpc } });
  expect(await (await POST(request({ session, host: true }))).json()).toEqual({
    snapshot: { items: [] },
  });
});
