import { describe, expect, it } from "vitest";
import { validReviewRequest } from "../../lib/reviews";
import { randomUUID } from "node:crypto";

describe("review request boundary", () => {
  const proposal = "66e1fcac-328e-4c9a-9a04-001ad1b97a55";
  it("accepts only the declared command shape and identifiers", () => {
    expect(validReviewRequest({ command: "approve", proposal })).toBe(true);
    for (const r of [
      { command: "approve", proposal, recipients: [] },
      { command: "approve", proposal: "forged" },
      { command: "reveal", proposal },
      { command: "read", offset: -1 },
      { command: "release", proposal, token: "old" },
      { command: "ack_policy", activity: "a1", group: proposal, policy: 2 },
    ])
      expect(validReviewRequest(r)).toBe(false);
  });
  it("rejects duplicate audiences, malformed text and arbitrary payloads", () => {
    const create = {
      command: "create",
      proposal,
      attempt: proposal,
      activity: "a2",
      fields: ["f1"],
      recipients: [proposal],
    };
    expect(validReviewRequest(create)).toBe(true);
    expect(
      validReviewRequest({
        ...create,
        fields: Array.from({ length: 20 }, (_, i) => `f${i}`),
        recipients: Array.from({ length: 40 }, () => randomUUID()),
      })
    ).toBe(true);
    for (const patch of [
      { recipients: [proposal, proposal] },
      { fields: ["\ud800"] },
      { fields: [] },
      { body: "private" },
      { activity: "\u0000" },
      { fields: Array.from({ length: 21 }, (_, i) => `f${i}`) },
      { recipients: Array.from({ length: 41 }, () => randomUUID()) },
    ])
      expect(validReviewRequest({ ...create, ...patch })).toBe(false);
  });
});
