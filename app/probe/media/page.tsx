import { notFound } from "next/navigation";
import { probeEnabled } from "../../../lib/media-probe";
import MediaProbe from "./probe";

export const dynamic = "force-dynamic";

export default function ProbePage() {
  if (!probeEnabled()) notFound();
  return <MediaProbe />;
}
