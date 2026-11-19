import type { Metadata } from "next";
import Link from "next/link";
import { supabaseConfig } from "../../lib/supabase";
import { requestPasswordReset } from "../auth/actions";
import { Form } from "../form";
import { HostProblem } from "../host-problem";

// Identity is per request; never prerender.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reset password · Debrio" };

export default async function ForgotPassword({
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
          If an account uses that address, we&apos;ve sent a link to reset its
          password. Open it in this browser. You&apos;ll also need your
          authenticator app.
        </p>
        <Link href="/sign-in">Back to sign in</Link>
      </main>
    );
  return (
    <main>
      <p className="wordmark">Debrio</p>
      <h1>Reset your password</h1>
      <p>
        Enter your account&apos;s email address. You&apos;ll also need your
        authenticator app to finish.
      </p>
      <Form
        action={requestPasswordReset}
        submit="Send reset link"
        fields={[
          {
            name: "email",
            label: "Email",
            type: "email",
            autoComplete: "email",
          },
        ]}
      />
      <p>
        <Link href="/sign-in">Back to sign in</Link>
      </p>
    </main>
  );
}
