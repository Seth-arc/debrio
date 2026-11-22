import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("../../lib/supabase", () => ({
  currentHost: async () => ({ state: "aal2", supabase: { rpc } }),
  guestSupabase: vi.fn(),
}));
import { runExecution } from "../../app/sessions/execution-actions";

test("missing or malformed execution acknowledgement retains the exact operation for retry", async () => {
  for (const data of [null, {}, { revision: "2", state: "live" }]) {
    rpc.mockResolvedValueOnce({ data, error: null });
    const operation = randomUUID();
    expect(
      await runExecution(randomUUID(), operation, 2, "next", "a".repeat(64))
    ).toMatchObject({ uncertain: true });
    expect(rpc).toHaveBeenLastCalledWith(
      "execution_command_v3",
      expect.objectContaining({ p_operation: operation })
    );
  }
});

test("a validated transition or deadline receipt completes the command", async () => {
  for (const data of [{ revision: 3, state: "live" }, { ended: true }]) {
    rpc.mockResolvedValueOnce({ data, error: null });
    expect(
      await runExecution(randomUUID(), randomUUID(), 2, "next", "a".repeat(64))
    ).toEqual({});
  }
});
