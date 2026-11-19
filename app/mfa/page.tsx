import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentHost } from "../../lib/supabase";
import { signOut, verifySignIn } from "../auth/actions";
import { Form } from "../form";
import { HostProblem } from "../host-problem";
import { CODE_FIELD, EnrollAuthenticator } from "./enroll";

// Identity is per request; never prerender.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Authenticator · Debrio" };

export default async function Mfa({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // Only the literal "account" is passed on; see destination() in the actions.
  const next = (await searchParams).next === "account" ? "account" : null;
  const host = await currentHost();
  if (host.state === "signed-out") redirect("/sign-in");
  if (host.state === "aal2") redirect(next ? "/account" : "/workspace");
  if (host.state !== "aal1") return <HostProblem state={host.state} />;
  const enrolled = host.verifiedFactorIds.length > 0;
  return (
    <main>
      <p className="wordmark">Debrio</p>
      {enrolled ? (
        <>
          <h1>Enter your authenticator code</h1>
          <p>Open your authenticator app and enter the code for Debrio.</p>
          <Form
            action={verifySignIn}
            submit="Continue"
            fields={[CODE_FIELD]}
            hidden={next ? { next } : {}}
          />
        </>
      ) : (
        <>
          <h1>Set up your authenticator</h1>
          <p>
            Workspace owners use an authenticator app as a second step when
            signing in. This protects your workshops and participants&apos; work
            if your password is ever exposed.
          </p>
          <EnrollAuthenticator
            start="Set up authenticator"
            next={next ?? undefined}
          />
        </>
      )}
      <form action={signOut}>
        <button type="submit" className="secondary">
          Sign out
        </button>
      </form>
    </main>
  );
}
