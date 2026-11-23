import { isUuid } from "./ids";

export const sessionReply = (body: object, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

type Envelope = {
  session: string;
  host: boolean;
  operation?: string;
  request?: Record<string, unknown>;
};

export async function readBoundedRequest(
  request: Request,
  invalid = "invalid_request"
): Promise<
  | { input: Record<string, unknown>; response?: never }
  | { response: Response; input?: never }
> {
  const reply = (body: object, status = 200) => ({
    response: sessionReply(body, status),
  });
  let origin: URL;
  try {
    origin = new URL(request.headers.get("origin") ?? "");
  } catch {
    return reply({ error: "not_allowed" }, 403);
  }
  // Next's internal request URL may use localhost behind the incoming Host.
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.host !== request.headers.get("host") ||
    request.headers.get("content-type") !== "application/json"
  )
    return reply({ error: "not_allowed" }, 403);
  const reader = request.body?.getReader();
  if (!reader) return reply({ error: invalid }, 400);
  let input;
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let text = "",
      size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 262144) {
        await reader.cancel();
        return reply({ error: invalid }, 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    input = JSON.parse(text);
  } catch {
    return reply({ error: invalid }, 400);
  } finally {
    reader.releaseLock();
  }
  if (!input || typeof input !== "object" || Array.isArray(input))
    return reply({ error: invalid }, 400);
  return { input };
}

export async function readSessionRequest(
  request: Request,
  invalid = "invalid_request"
): Promise<
  { input: Envelope; response?: never } | { response: Response; input?: never }
> {
  const parsed = await readBoundedRequest(request, invalid);
  if (parsed.response) return parsed;
  const { input } = parsed;
  const reply = (body: object, status: number) => ({
    response: sessionReply(body, status),
  });
  if (
    typeof input.session !== "string" ||
    !isUuid(input.session) ||
    typeof input.host !== "boolean" ||
    Object.keys(input).some(
      (key) => !["session", "host", "operation", "request"].includes(key)
    )
  )
    return reply({ error: invalid }, 400);

  if (
    input.request !== undefined &&
    (!input.request ||
      typeof input.request !== "object" ||
      Array.isArray(input.request))
  )
    return reply({ error: invalid }, 400);
  return { input: input as Envelope };
}
