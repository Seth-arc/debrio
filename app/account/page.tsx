import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentHost, hasFreshCode } from "../../lib/supabase";
import {
  changeEmail,
  changePassword,
  confirmIdentity,
  signOut,
} from "../auth/actions";
import { Form, NEW_PASSWORD_RULE } from "../form";
import { HostProblem } from "../host-problem";
import { CODE_FIELD } from "../mfa/enroll";
import { emailNotice, otherNotice } from "../notices";

// Identity is per request; never prerender.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Account · Debrio" };

export default async function Account({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; status?: string }>;
}) {
  const { email, status } = await searchParams;
  const host = await currentHost();
  if (host.state === "signed-out")
    redirect(
      emailNotice(email, "signed-out") ? `/sign-in?email=${email}` : "/sign-in"
    );
  if (host.state === "aal1") redirect("/mfa?next=account");
  if (host.state !== "aal2") return <HostProblem state={host.state} />;
  // "changed" is only claimed once Auth shows no pending address.
  const notice =
    (email === "changed" && host.user.new_email
      ? undefined
      : emailNotice(email, "signed-in")) ?? otherNotice(status);
  const signOutForm = (
    <form action={signOut}>
      <button type="submit" className="secondary">
        Sign out
      </button>
    </form>
  );
  if (!hasFreshCode(host.codeVerifiedAt))
    return (
      <main>
        <p className="wordmark">Debrio</p>
        <h1>Confirm it&apos;s you</h1>
        {notice && <p role="status">{notice}</p>}
        <p>
          Enter a code from your authenticator app before changing your password
          or email.
        </p>
        <Form
          action={confirmIdentity}
          submit="Continue"
          fields={[CODE_FIELD]}
        />
        <Link href="/workspace">Back to your workspace</Link>
      </main>
    );
  return (
    <main>
      <p className="wordmark">Debrio</p>
      <h1>Account and sign-in</h1>
      {notice && <p role="status">{notice}</p>}
      <p>
        Signed in as <strong>{host.user.email}</strong>.
      </p>
      {host.user.new_email && (
        <p>
          Waiting to change to <strong>{host.user.new_email}</strong>. Open the
          links sent to both addresses.
        </p>
      )}
      <section aria-labelledby="password-heading">
        <h2 id="password-heading">Change password</h2>
        <p>Your other devices will be signed out.</p>
        <Form
          action={changePassword}
          submit="Change password"
          fields={[
            { name: "password", label: "New password", ...NEW_PASSWORD_RULE },
          ]}
        />
      </section>
      <section aria-labelledby="email-heading">
        <h2 id="email-heading">Change email</h2>
        <p>
          We&apos;ll send a link to your current and your new address. Both must
          be opened.
        </p>
        <Form
          action={changeEmail}
          submit="Change email"
          fields={[
            {
              name: "email",
              label: "New email",
              type: "email",
              autoComplete: "email",
            },
          ]}
        />
      </section>
      <p>
        <Link href="/workspace">Back to your workspace</Link>
      </p>
      {signOutForm}
    </main>
  );
}
