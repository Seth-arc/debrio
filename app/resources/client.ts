import type { ResourceReply } from "../../lib/resources";

export type ResourceEnvelope = {
  workspace?: string;
  session?: string;
  host: boolean;
  resource?: string;
  allocation?: string;
  offset?: number;
  metadataOnly?: boolean;
  operation?: string;
  request?: object;
};

export async function requestResource(
  input: ResourceEnvelope
): Promise<ResourceReply> {
  const response = await fetch("/api/resources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  return response.json();
}
