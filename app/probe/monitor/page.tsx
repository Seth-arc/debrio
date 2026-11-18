import { notFound } from "next/navigation";
import { probeEnabled } from "../../../lib/media-probe";
import MonitoringProbe from "./probe";
export const dynamic = "force-dynamic";
export default function Page() {
  if (!probeEnabled() || process.env.MEDIA_MONITOR_PROBE !== "1") notFound();
  return <MonitoringProbe />;
}
