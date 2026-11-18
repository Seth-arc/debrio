// Samples crossing the deadline cannot establish which side received a packet.
export function classifyAgoraCutoff(samples, deadline) {
  const before = samples.findLast((s) => s.at <= deadline);
  const after = samples.filter((s) => s.at > deadline);
  const whollyAfter = after.filter((s) => s.startedAt >= deadline);
  const direction = (index) => {
    if (!before || after.length < 2) return "Unverified";
    const counts = [before, ...after].map((s) => s.states.at(index)?.inbound);
    if (
      counts.some(
        (count, i) =>
          !Number.isSafeInteger(count) ||
          count <= 0 ||
          (i > 0 && count < counts.at(i - 1))
      )
    )
      return "Unverified";
    if (counts.every((count) => count === counts[0])) return "Pass";
    if (
      whollyAfter.length >= 2 &&
      whollyAfter.at(-1).states.at(index).inbound >
        whollyAfter[0].states.at(index).inbound
    )
      return "Fail";
    return "Unverified";
  };
  const publish = direction(1);
  const receive = direction(0);
  const verdict = [publish, receive].includes("Fail")
    ? "Fail"
    : publish === "Pass" && receive === "Pass"
      ? "Pass"
      : "Unverified";
  return { publish, receive, verdict };
}
