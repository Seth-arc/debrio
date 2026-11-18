import { expect, test } from "vitest";
import { GET } from "../../app/api/health/route";

test("liveness returns only its public status and cannot be cached", async () => {
  const response = GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ status: "ok" });
});
