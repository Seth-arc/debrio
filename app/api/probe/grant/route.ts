import { issueProbeGrant } from "../../../../lib/media-probe";
import { probeRequest } from "../../../../lib/probe-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = (request: Request) =>
  process.env.MEDIA_MONITOR_PROBE === "1"
    ? new Response(null, {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      })
    : probeRequest(request, issueProbeGrant);
