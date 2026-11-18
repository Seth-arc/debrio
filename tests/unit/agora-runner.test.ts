import { EventEmitter } from "node:events";
import { writeFile, rm } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(
    async () =>
      `AGORA_APP_ID=${"a".repeat(32)}\nAGORA_APP_CERTIFICATE=${"b".repeat(32)}\n`
  ),
  mkdir: vi.fn(),
  open: vi.fn(async () => ({ close: vi.fn() })),
  writeFile: vi.fn(),
  rm: vi.fn(),
}));
vi.mock("node:http", () => ({
  createServer: () => {
    const server = Object.assign(new EventEmitter(), {
      listening: false,
      listen() {
        this.listening = true;
        queueMicrotask(() => server.emit("listening"));
      },
      closeAllConnections: vi.fn(),
      close(callback: () => void) {
        this.listening = false;
        callback();
      },
    });
    return server;
  },
}));
vi.mock("@playwright/test", () => ({
  chromium: { launchServer: vi.fn(), connect: vi.fn() },
}));

it("P1-01-AC3 cancellation during browser launch kills the owned process without hosted joins", async () => {
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;
  const kill = vi.fn(async () => {});
  vi.stubEnv("AGORA_PROBE_CONFIRMED", "1");
  vi.stubEnv("CI", "");
  vi.stubEnv("VERCEL", "");
  process.argv = [process.execPath, "runner", "ignored.env"];
  vi.mocked(chromium.launchServer).mockImplementationOnce(async () => {
    process.listeners("SIGINT").at(-1)?.("SIGINT");
    return {
      kill,
      process: () => ({ exitCode: 0, signalCode: null }),
    } as unknown as Awaited<ReturnType<typeof chromium.launchServer>>;
  });
  try {
    await import("../../scripts/" + "run-agora-probe.mjs");
    expect(chromium.connect).not.toHaveBeenCalled();
    expect(kill).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
    const receipt = JSON.parse(vi.mocked(writeFile).mock.calls[0][1] as string);
    expect(receipt.interrupted).toBe(true);
    expect(receipt.cleanup.browserProcessExited).toBe(true);
    expect(receipt.cleanup.localServerClosed).toBe(true);
    expect(rm).toHaveBeenCalledWith(".artifacts/P1-01/agora-run.lock");
  } finally {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    vi.unstubAllEnvs();
  }
});
