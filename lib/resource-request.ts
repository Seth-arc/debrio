import { isUuid } from "./ids";
import { readBoundedRequest, sessionReply } from "./session-request";
import { validWorkText } from "./work";

export type ResourceEnvelope = {
  workspace?: string;
  session?: string;
  host: boolean;
  operation?: string;
  resource?: string;
  allocation?: string;
  offset?: number;
  metadataOnly?: boolean;
  request?: Record<string, unknown>;
};

export async function readResourceRequest(
  request: Request
): Promise<
  | { input: ResourceEnvelope; response?: never }
  | { response: Response; input?: never }
> {
  const parsed = await readBoundedRequest(request, "invalid_resource");
  if (parsed.response) return parsed;
  const x = parsed.input;
  const invalid = () => ({
    response: sessionReply({ error: "invalid_resource" }, 400),
  });
  const fields = [
    "workspace",
    "session",
    "host",
    "operation",
    "resource",
    "allocation",
    "offset",
    "request",
    "metadataOnly",
  ];
  if (
    Object.keys(x).some((k) => !fields.includes(k)) ||
    typeof x.host !== "boolean" ||
    (x.workspace === undefined) === (x.session === undefined) ||
    (x.workspace !== undefined && !x.host) ||
    (x.resource !== undefined && x.workspace === undefined) ||
    (x.allocation !== undefined && x.session === undefined) ||
    (x.metadataOnly !== undefined &&
      (typeof x.metadataOnly !== "boolean" ||
        x.workspace === undefined ||
        x.request !== undefined)) ||
    [x.workspace, x.session, x.operation, x.resource, x.allocation].some(
      (v) => v !== undefined && (typeof v !== "string" || !isUuid(v))
    ) ||
    (x.offset !== undefined &&
      (!Number.isSafeInteger(x.offset) || (x.offset as number) < 0))
  )
    return invalid();
  if (x.request !== undefined) {
    if (!x.request || typeof x.request !== "object" || Array.isArray(x.request))
      return invalid();
    const r = x.request as Record<string, unknown>;
    if (typeof r.command !== "string") return invalid();
    // Reject malformed Unicode before the JSON reaches PostgreSQL, including nested selectors.
    const stringsValid = (v: unknown, depth = 0): boolean =>
      depth > 8
        ? false
        : typeof v === "string"
          ? validWorkText(v, 20000)
          : Array.isArray(v)
            ? v.every((item) => stringsValid(item, depth + 1))
            : v && typeof v === "object"
              ? Object.entries(v).every(
                  ([k, val]) =>
                    validWorkText(k, 120) && stringsValid(val, depth + 1)
                )
              : true;
    if (!stringsValid(r)) return invalid();
    if (!["preview", "check"].includes(r.command) && x.operation === undefined)
      return invalid();
    if (!x.host && !["ack", "dismiss"].includes(r.command))
      return { response: sessionReply({ error: "not_allowed" }, 403) };
  }
  return { input: x as ResourceEnvelope };
}
