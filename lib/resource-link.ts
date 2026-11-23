import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import type { TLSSocket } from "node:tls";

export class ResourceLinkError extends Error {
  constructor(
    public readonly code:
      | "invalid_link"
      | "blocked_link"
      | "link_failed"
      | "link_timeout"
      | "link_too_large"
      | "link_redirect_limit"
  ) {
    // Never propagate a transport error containing URLs, credentials or bodies.
    super(code);
    this.name = "ResourceLinkError";
  }
}

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  blocked.addSubnet(address, prefix, "ipv6");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");

export function isPublicResourceAddress(address: string) {
  if (address.includes("%")) return false;
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  // Fail closed on special/translation ranges, including mapped private IPv4.
  return (
    family === 6 &&
    globalV6.check(address, "ipv6") &&
    !blocked.check(address, "ipv6")
  );
}

export function normalizeResourceUrl(value: string): string {
  if (
    typeof value !== "string" ||
    !value.isWellFormed() ||
    [...value].length > 2048 ||
    /[\s\u0000-\u001f\u007f\\]/u.test(value)
  )
    throw new ResourceLinkError("invalid_link");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ResourceLinkError("invalid_link");
  }
  const authority = /^https:\/\/([^/?#]+)/i.exec(value)?.[1];
  const host = url.hostname;
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !authority ||
    !/^[a-z0-9.-]+(?::443)?$/i.test(authority) ||
    authority.toLowerCase().replace(/:443$/, "") !== host ||
    isIP(host) ||
    host.length > 253 ||
    !host.includes(".") ||
    host
      .split(".")
      .some(
        (label) =>
          label.length === 0 ||
          label.length > 63 ||
          !/^[a-z0-9-]+$/.test(label) ||
          label.startsWith("-") ||
          label.endsWith("-")
      ) ||
    !/[a-z]/.test(host.split(".").at(-1)!) ||
    /\.(?:localhost|local|internal|home|lan|invalid|test|example|onion)$/i.test(
      host
    ) ||
    url.href.length > 2048
  )
    throw new ResourceLinkError("invalid_link");
  return url.href;
}

export const resourceUrlDigest = (normalizedUrl: string) =>
  createHash("sha256").update(normalizedUrl).digest("hex");

export type ResourceLinkCheck = {
  url: string;
  urlDigest: string;
  finalUrl: string;
  chainDigest: string;
  checkedAt: string;
  status: number;
};

function sameAddress(actual: string | undefined, expected: string) {
  if (!actual) return false;
  if (isIP(expected) === 4)
    return actual === expected || actual === `::ffff:${expected}`;
  return (
    isIP(actual) === 6 &&
    new URL(`http://[${actual}]/`).hostname ===
      new URL(`http://[${expected}]/`).hostname
  );
}

async function resolvePublic(host: string, signal: AbortSignal) {
  let onAbort: () => void = () => {};
  try {
    const addresses = await Promise.race([
      lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(new ResourceLinkError("link_timeout"));
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      }),
    ]);
    if (
      addresses.length === 0 ||
      addresses.length > 64 ||
      addresses.some(
        ({ address, family }) =>
          !isPublicResourceAddress(address) || isIP(address) !== family
      )
    )
      throw new ResourceLinkError("blocked_link");
    return addresses[0];
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export async function validateResourceLink(
  value: string
): Promise<ResourceLinkCheck> {
  const saved = normalizeResourceUrl(value);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const chain: { url: string; status: number }[] = [];
  let current = saved;
  let bytes = 0;
  try {
    for (let redirects = 0; ; redirects++) {
      const url = new URL(current);
      const address = await resolvePublic(url.hostname, controller.signal);
      controller.signal.throwIfAborted();
      const response = await new Promise<{ status: number; location?: string }>(
        (resolve, reject) => {
          const req = request(
            {
              protocol: "https:",
              hostname: url.hostname,
              port: 443,
              path: url.pathname + url.search,
              method: "GET",
              agent: false,
              family: address.family,
              servername: url.hostname,
              rejectUnauthorized: true,
              signal: controller.signal,
              maxHeaderSize: 16_384,
              headers: { Accept: "*/*", "Accept-Encoding": "identity" },
              // Pin this request to the already inspected DNS result.
              lookup: (_hostname, _options, callback) =>
                callback(null, address.address, address.family),
            },
            (res) => {
              const socket = res.socket as TLSSocket;
              if (
                !socket.authorized ||
                !sameAddress(socket.remoteAddress, address.address)
              ) {
                const error = new ResourceLinkError("blocked_link");
                reject(error);
                req.destroy(error);
                return;
              }
              const status = res.statusCode ?? 0;
              if (!(
                (status >= 200 && status < 300) ||
                [301, 302, 303, 307, 308].includes(status)
              )) {
                const error = new ResourceLinkError("link_failed");
                reject(error);
                req.destroy(error);
                return;
              }
              res.on("data", (chunk: Buffer) => {
                bytes += chunk.length;
                if (bytes > 65_536) {
                  const error = new ResourceLinkError("link_too_large");
                  reject(error);
                  req.destroy(error);
                }
              });
              res.once("end", () =>
                resolve({ status, location: res.headers.location })
              );
              res.once("error", reject);
              res.once("aborted", () =>
                reject(new ResourceLinkError("link_failed"))
              );
            }
          );
          req.once("error", reject);
          req.end();
        }
      );
      chain.push({ url: current, status: response.status });
      if (response.status >= 200 && response.status < 300)
        return {
          url: saved,
          urlDigest: resourceUrlDigest(saved),
          finalUrl: current,
          chainDigest: resourceUrlDigest(JSON.stringify(chain)),
          checkedAt: new Date().toISOString(),
          status: response.status,
        };
      if (redirects >= 3) throw new ResourceLinkError("link_redirect_limit");
      if (!response.location) throw new ResourceLinkError("link_failed");
      // Inspect raw authorities before URL parsing can normalize ambiguous syntax.
      if (/[\s\u0000-\u001f\u007f\\]/u.test(response.location))
        throw new ResourceLinkError("invalid_link");
      current = normalizeResourceUrl(
        response.location.startsWith("//")
          ? `https:${response.location}`
          : /^[a-z][a-z0-9+.-]*:/i.test(response.location)
            ? response.location
            : new URL(response.location, current).href
      );
    }
  } catch (error) {
    if (controller.signal.aborted) throw new ResourceLinkError("link_timeout");
    if (error instanceof ResourceLinkError) throw error;
    throw new ResourceLinkError("link_failed");
  } finally {
    clearTimeout(timeout);
  }
}
