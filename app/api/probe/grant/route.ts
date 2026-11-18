import { issueProbeGrant, probeEnabled } from "../../../../lib/media-probe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  if (!probeEnabled()) return new Response(null, { status: 404, headers });
  if (
    !process.env.MEDIA_PROBE_ORIGIN ||
    request.headers.get("origin") !== process.env.MEDIA_PROBE_ORIGIN ||
    request.headers.get("content-type") !== "application/json"
  ) {
    return new Response(null, { status: 403, headers });
  }
  let text = "";
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400, headers });
  try {
    let size = 0;
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024) {
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
    const grant = await issueProbeGrant(input);
    return grant
      ? Response.json(grant, { headers })
      : new Response(null, { status: 403, headers });
  } catch {
    return Response.json(
      { error: "Probe unavailable. Ask the operator to check setup." },
      { status: 503, headers }
    );
  } finally {
    reader.releaseLock();
  }
}
