import { handleMonitor } from "../../../../lib/monitor-probe";
import { probeRequest } from "../../../../lib/probe-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request) {
  if (process.env.MEDIA_MONITOR_PROBE !== "1")
    return Promise.resolve(new Response(null, { status: 404 }));
  return probeRequest(request, handleMonitor, 16384);
}
