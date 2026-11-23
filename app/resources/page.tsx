import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentHost } from "../../lib/supabase";
import { HostProblem } from "../host-problem";
import { ResourceLibraryPanel } from "./library";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Resources · Debrio" };

export default async function Resources() {
  const host = await currentHost();
  if (host.state === "signed-out") redirect("/sign-in");
  if (host.state === "aal1") redirect("/mfa");
  if (host.state !== "aal2") return <HostProblem state={host.state} />;
  const { data, error } = await host.supabase
    .from("workspaces")
    .select("id")
    .maybeSingle();
  if (!data && !error) redirect("/workspace");
  return (
    <main className="resource-panel">
      <p className="wordmark">Debrio</p>
      <Link href="/workspace">Back to your workspace</Link>
      <h1>Resource library</h1>
      <p>
        Reusable text and HTTPS links belong to your workspace. Ready versions
        stay fixed; releasing a resource is a separate session action.
      </p>
      {data ? (
        <ResourceLibraryPanel workspace={data.id} />
      ) : (
        <p role="alert">
          The resource library is unavailable. Reload to try again.
        </p>
      )}
    </main>
  );
}
