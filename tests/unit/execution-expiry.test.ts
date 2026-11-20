import { afterEach, expect, test, vi } from "vitest";
import { POST } from "../../app/api/execution/expire/route";

afterEach(() => vi.unstubAllEnvs());

test("scheduled expiry is disabled without server configuration", async () => {
  vi.stubEnv("EXECUTION_DISPATCH_SECRET", "");
  const response = await POST(
    new Request("http://localhost/api/execution/expire", { method: "POST" })
  );
  expect(response.status).toBe(503);
});

test("a missing or wrong scheduler secret never reaches the database", async () => {
  vi.stubEnv(
    "EXECUTION_DISPATCH_SECRET",
    "synthetic-dispatch-secret-long-enough-0001"
  );
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "unused-synthetic-key");
  vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:1");
  for (const authorization of [
    "",
    "Bearer wrong",
    "Bearer synthetic-dispatch-secret-long-enough-0002",
  ]) {
    expect(
      (
        await POST(
          new Request("http://localhost/api/execution/expire", {
            method: "POST",
            headers: { authorization },
          })
        )
      ).status
    ).toBe(401);
  }
});
