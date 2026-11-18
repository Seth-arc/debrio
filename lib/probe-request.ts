import { probeEnabled } from "./media-probe";

export class ProbeError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export async function probeRequest(
  request: Request,
  handle: (input: unknown) => Promise<unknown>,
  limit = 1024
) {
  const headers = { "Cache-Control": "no-store" };
  if (!probeEnabled()) return new Response(null, { status: 404, headers });
  if (
    !process.env.MEDIA_PROBE_ORIGIN ||
    request.headers.get("origin") !== process.env.MEDIA_PROBE_ORIGIN ||
    request.headers.get("content-type") !== "application/json"
  )
    return new Response(null, { status: 403, headers });
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400, headers });
  try {
    let size = 0;
    let text = "";
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return new Response(null, { status: 413, headers });
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch {
      return new Response(null, { status: 400, headers });
    }
    const result = await handle(input);
    return result === undefined
      ? new Response(null, { status: 403, headers })
      : Response.json(result, { headers });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof ProbeError
            ? error.message
            : "Probe unavailable. Retry after checking local setup.",
      },
      { status: error instanceof ProbeError ? error.status : 503, headers }
    );
  } finally {
    reader.releaseLock();
  }
}
