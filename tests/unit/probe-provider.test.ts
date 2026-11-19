import { expect, it } from "vitest";
import {
  probeProviderAllowed,
  revocationCutoff,
} from "../../lib/probe-provider";

it("keeps hosted media local-operator only and refuses unintended credential destinations", () => {
  expect(probeProviderAllowed("ws://127.0.0.1:7880", false, false, true)).toBe(
    true
  );
  expect(
    probeProviderAllowed("wss://fixture.livekit.cloud", true, true, false)
  ).toBe(true);
  for (const value of [
    undefined,
    "https://fixture.livekit.cloud",
    "wss://evil.test",
    "wss://fixture.livekit.cloud.evil.test",
    "wss://user:secret@fixture.livekit.cloud",
    "wss://fixture.livekit.cloud:444",
    "wss://fixture.livekit.cloud/path",
    "wss://fixture.livekit.cloud?key=x",
    "wss://fixture.livekit.cloud#x",
  ]) {
    expect(probeProviderAllowed(value, true, true, false)).toBe(false);
  }
  expect(
    probeProviderAllowed("wss://fixture.livekit.cloud", true, false, false)
  ).toBe(false);
  expect(
    probeProviderAllowed("wss://fixture.livekit.cloud", true, true, true)
  ).toBe(false);
  expect(
    probeProviderAllowed("wss://fixture.livekit.cloud", false, true, false)
  ).toBe(false);
});

it("sets a strict cutoff beyond a same-second token without exceeding the documented clock window", () => {
  const now = 1795040000999;
  expect(revocationCutoff(now)).toBeGreaterThan(BigInt(Math.floor(now / 1000)));
  expect(Number(revocationCutoff(now)) * 1000 - now).toBeLessThan(60_000);
});
