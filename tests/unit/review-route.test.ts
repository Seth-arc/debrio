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
import { POST } from "../../app/api/reviews/route";
const id = "11111111-1111-4111-8111-111111111111";
function request(body: unknown, origin = "http://127.0.0.1:3100") {
  return new Request("http://127.0.0.1:3100/api/reviews", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3100",
      origin,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: { items: [] }, error: null });
  currentHost.mockResolvedValue({ state: "aal2", supabase: { rpc } });
  cookie.mockReturnValue({ value: "synthetic-only" });
});
test("review HTTP boundary rejects foreign origins, oversized or forged envelopes before RPC", async () => {
  const body = { session: id, host: false };
  expect((await POST(request(body, "http://foreign.invalid"))).status).toBe(
    403
  );
  expect(
    (await POST(request({ ...body, padding: "x".repeat(262144) }))).status
  ).toBe(413);
  for (const extra of [
    { credential: "forged" },
    { host: null },
    {
      request: { command: "close", proposal: id, reason: "\ud800" },
      operation: id,
    },
  ])
    expect((await POST(request({ ...body, ...extra }))).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
  const response = await POST(request(body));
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(rpc).toHaveBeenCalledWith(
    "read_reviews",
    expect.objectContaining({
      p_host: false,
      p_credential_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
  );
});
test("current authority and unknown write outcomes are explicit without private error detail", async () => {
  currentHost.mockResolvedValue({ state: "aal1" });
  expect((await POST(request({ session: id, host: true }))).status).toBe(403);
  cookie.mockReturnValue(undefined);
  expect((await POST(request({ session: id, host: false }))).status).toBe(403);
  currentHost.mockResolvedValue({ state: "aal2", supabase: { rpc } });
  const body = {
    session: id,
    host: true,
    operation: id,
    request: { command: "request", proposal: id },
  };
  rpc.mockResolvedValue({
    error: { message: "stale_review", details: "PRIVATE" },
  });
  expect(await (await POST(request(body))).json()).toEqual({
    error: "stale_review",
    uncertain: false,
  });
  rpc.mockRejectedValue(Error("PRIVATE transport detail"));
  expect(await (await POST(request(body))).json()).toEqual({
    error: "unavailable",
    uncertain: true,
  });
});
