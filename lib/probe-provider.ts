export function probeProviderAllowed(
  value: string | undefined,
  cloud: boolean,
  confirmed: boolean,
  automated: boolean
) {
  if (!cloud) return value === "ws://127.0.0.1:7880";
  if (!confirmed || automated || !value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "wss:" &&
      /^[a-z0-9-]+\.livekit\.cloud$/.test(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

// New routes use unique identities; the forward cutoff also fences same-second refreshes.
export function revocationCutoff(now = Date.now()) {
  return BigInt(Math.floor(now / 1000) + 30);
}
