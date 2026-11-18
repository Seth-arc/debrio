import { createRequire } from "node:module";
import { expect, it } from "vitest";
const require = createRequire(import.meta.url);
const { AccessToken2 } = require("agora-token/src/AccessToken2");
const { issueAgoraGrant } = await import("../../scripts/" + "agora-grant.mjs");
const input = {
  appId: "a".repeat(32),
  certificate: "b".repeat(32),
  channel: "p101-0123456789abcdef-a",
  uid: 101,
  publish: true,
  authorizedAt: 1_000_999,
  runExpiresAt: 2_000_000,
};
it("P1-01-AC2 signs exact identity/room and only the permitted audio privilege", () => {
  for (const publish of [true, false]) {
    const grant = issueAgoraGrant({ ...input, publish }, 1_001_000);
    const parsed = new AccessToken2();
    expect(parsed.from_string(grant.token)).toBe(true);
    expect(parsed.verifySignature(input.certificate)).toBe(true);
    expect(parsed.verifySignature("c".repeat(32))).toBe(false);
    expect(parsed.services).toHaveLength(1);
    expect(parsed.services[0].__channel_name.toString()).toBe(input.channel);
    expect(parsed.services[0].__uid.toString()).toBe("101");
    expect(parsed.services[0].__privileges).toEqual(
      publish ? { 1: 10, 2: 10 } : { 1: 10 }
    );
    expect((parsed.issueTs + parsed.expire) * 1000).toBe(grant.expiresAt);
    expect(grant.expiresAt).toBeLessThanOrEqual(input.authorizedAt + 10_000);
  }
});
it("P1-01-AC2 delayed signing cannot extend authority; rejects stale/invalid grants", () => {
  expect(issueAgoraGrant(input, 1_009_000).expiresAt).toBe(1_010_000);
  expect(
    issueAgoraGrant({ ...input, runExpiresAt: 1_005_500 }, 1_001_000).expiresAt
  ).toBe(1_005_000);
  for (const changes of [
    { uid: 0 },
    { uid: 104 },
    { channel: "*" },
    { channel: "production" },
    { appId: "" },
    { certificate: "wrong" },
    { publish: "true" },
    { authorizedAt: 1_100_000 },
    { authorizedAt: NaN },
    { runExpiresAt: 1_000_000 },
  ])
    expect(() =>
      issueAgoraGrant({ ...input, ...changes }, 1_001_000)
    ).toThrow();
  expect(() => issueAgoraGrant(input, 1_010_000)).toThrow(
    "Expired authorization"
  );
});
