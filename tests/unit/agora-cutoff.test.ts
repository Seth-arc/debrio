import { expect, it } from "vitest";
const { classifyAgoraCutoff } = await import(
  "../../scripts/" + "agora-cutoff.mjs"
);
const sample = (
  startedAt: number,
  at: number,
  receive: number,
  publish = receive
) => ({ startedAt, at, states: [{ inbound: receive }, { inbound: publish }] });

it("P1-01-AC2 distinguishes a stopped stream from verified postdeadline delivery", () => {
  expect(
    classifyAgoraCutoff(
      [
        sample(14800, 14810, 100),
        sample(15100, 15110, 100),
        sample(16000, 16010, 100),
      ],
      15000
    )
  ).toEqual({ publish: "Pass", receive: "Pass", verdict: "Pass" });
  expect(
    classifyAgoraCutoff(
      [
        sample(14800, 14810, 100),
        sample(15100, 15110, 110),
        sample(16000, 16010, 120, 110),
      ],
      15000
    )
  ).toEqual({ publish: "Unverified", receive: "Fail", verdict: "Fail" });
});

it("P1-01-AC2 retains uncertainty for straddling observations, counter resets and missing samples", () => {
  for (const samples of [
    [
      sample(14800, 14810, 100),
      sample(15100, 15110, 110),
      sample(16000, 16010, 110),
    ],
    [
      sample(14800, 14810, 100),
      sample(14990, 15010, 110),
      sample(16000, 16010, 120),
    ],
    [
      sample(14800, 14810, 100),
      sample(15100, 15110, 90),
      sample(16000, 16010, 90),
    ],
    [sample(14800, 14810, 100)],
  ])
    expect(classifyAgoraCutoff(samples, 15000).verdict).toBe("Unverified");
});
