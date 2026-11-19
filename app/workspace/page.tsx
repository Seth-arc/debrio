import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentHost } from "../../lib/supabase";
import { signOut } from "../auth/actions";
import { Form } from "../form";
import { HostProblem } from "../host-problem";
import { EnrollAuthenticator } from "../mfa/enroll";
import { createWorkspace } from "./actions";

// Identity is per request; never prerender.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Workspace · Debrio" };

export default async function Workspace() {
  const host = await currentHost();
  if (host.state === "signed-out") redirect("/sign-in");
  if (host.state === "aal1") redirect("/mfa");
  if (host.state !== "aal2") return <HostProblem state={host.state} />;
  const { data: workspace, error } = await host.supabase
    .from("workspaces")
    .select("name")
    // shortcut: assumes one owned workspace (unique index); list them when the switcher lands.
    .maybeSingle();
  const signOutForm = (
    <form action={signOut}>
      <button type="submit" className="secondary">
        Sign out
      </button>
    </form>
  );
  if (error)
    return (
      <main>
        <p className="wordmark">Debrio</p>
        <h1>Workspace service unavailable</h1>
        <p role="status">
          We couldn&apos;t load your workspace. Nothing was changed.
        </p>
        <Link href="/workspace">Try again</Link>
        {signOutForm}
      </main>
    );
  if (!workspace)
    return (
      <main>
        <p className="wordmark">Debrio</p>
        <h1>Create your workspace</h1>
        <p>
          Your workspace holds your workshops and is yours alone. You can run it
          on your own; no company or team is needed.
        </p>
        <Form
          action={createWorkspace}
          submit="Create workspace"
          fields={[
            {
              name: "name",
              label: "Workspace name",
              hint: "For example, your name or your practice's name. Up to 80 characters.",
              maxLength: 80,
              autoComplete: "organization",
            },
          ]}
        />
        {signOutForm}
      </main>
    );
  return (
    <main>
      <p className="wordmark">Debrio</p>
      <h1>{workspace.name}</h1>
      <p>
        You own this workspace. Signed in as <strong>{host.user.email}</strong>.
      </p>
      <section aria-labelledby="security">
        <h2 id="security">Sign-in security</h2>
        <p>
          {host.verifiedFactorIds.length === 1
            ? "1 authenticator is set up."
            : `${host.verifiedFactorIds.length} authenticators are set up.`}
        </p>
        {host.verifiedFactorIds.length === 1 && (
          <>
            <p>
              Add a backup authenticator, such as a second device or a password
              manager, so you can still sign in if you lose this one.
            </p>
            <EnrollAuthenticator start="Add a backup authenticator" />
          </>
        )}
      </section>
      {signOutForm}
    </main>
  );
}
