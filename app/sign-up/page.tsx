import Link from "next/link";
import type { Metadata } from "next";
import { signUp } from "../auth/actions";
import { supabaseConfig } from "../../lib/supabase";
import { Form, NEW_PASSWORD_RULE } from "../form";
import { HostProblem } from "../host-problem";

// Identity is per request; never prerender.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Create an account · Debrio" };

export default async function SignUp({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  if (!supabaseConfig()) return <HostProblem state="unconfigured" />;
  if ((await searchParams).sent)
    return (
      <main>
        <p className="wordmark">Debrio</p>
        <h1>Check your email</h1>
        <p role="status">
          If the address can be used, we&apos;ve sent a link to confirm it. Open
          the link in this browser to continue.
        </p>
        <Link href="/sign-in">Go to sign in</Link>
      </main>
    );
  return (
    <main>
      <p className="wordmark">Debrio</p>
      <h1>Create your account</h1>
      <p>
        Run workshops on your own or with a team. You don&apos;t need a company
        or a work email address.
      </p>
      <Form
        action={signUp}
        submit="Create account"
        fields={[
          {
            name: "email",
            label: "Email",
            type: "email",
            autoComplete: "email",
          },
          { name: "password", label: "Password", ...NEW_PASSWORD_RULE },
        ]}
      />
      <p>
        Already have an account? <Link href="/sign-in">Sign in</Link>
      </p>
    </main>
  );
}
