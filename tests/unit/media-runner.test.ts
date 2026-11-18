import { EventEmitter } from "node:events";
import { spawn, spawnSync } from "node:child_process";
import { RoomServiceClient } from "livekit-server-sdk";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(),
  open: vi.fn(async () => ({ close: vi.fn() })),
  writeFile: vi.fn(),
  rm: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawn: vi.fn(), spawnSync: vi.fn() }));
vi.mock("livekit-server-sdk", () => ({
  RoomServiceClient: vi.fn(
    class {
      listRooms = vi.fn(async () => []);
      createRoom = vi.fn(async () => {});
      deleteRoom = vi.fn(async () => {});
    }
  ),
}));
const exitCode = process.exitCode;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: "" } as ReturnType<
    typeof spawnSync
  >);
});
afterEach(() => {
  process.exitCode = exitCode;
  vi.restoreAllMocks();
});
const run = () => import("../../scripts/" + "run-media-probe.mjs");

it("P1-01 cleanup: interruption during room creation never launches a child", async () => {
  const created = vi.fn(async () => {
    process.listeners("SIGINT").at(-1)?.("SIGINT");
  });
  const deleted = vi.fn(async () => {});
  vi.mocked(RoomServiceClient).mockImplementationOnce(
    class {
      listRooms = vi.fn(async () => []);
      createRoom = created;
      deleteRoom = deleted;
    } as unknown as typeof RoomServiceClient
  );
  await expect(run()).rejects.toThrow("Probe interrupted before launch");
  expect(created).toHaveBeenCalledTimes(1);
  expect(spawn).not.toHaveBeenCalled();
  expect(deleted).toHaveBeenCalled();
  expect(spawnSync).toHaveBeenLastCalledWith(
    "docker",
    ["compose", "-f", "compose.media-probe.yaml", "down"],
    { stdio: "inherit" }
  );
});

it("P1-01 cleanup: an interactive child startup failure returns failure after cleanup", async () => {
  vi.mocked(spawn).mockImplementationOnce(() => {
    const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
    queueMicrotask(() => child.emit("exit", 1));
    return child as unknown as ReturnType<typeof spawn>;
  });
  await run();
  expect(process.exitCode).toBe(1);
  expect(spawnSync).toHaveBeenLastCalledWith(
    "docker",
    ["compose", "-f", "compose.media-probe.yaml", "down"],
    { stdio: "inherit" }
  );
});
