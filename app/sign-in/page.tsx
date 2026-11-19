import Link from "next/link";
import type { Metadata } from "next";
import { signIn } from "../auth/actions";
import { supabaseConfig } from "../../lib/supabase";
import { Form } from "../form";
import { HostProblem } from "../host-problem";
import { emailNotice } from "../notices";

// Identity is per request; never prerender.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in · Debrio" };

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ confirm?: string; email?: string }>;
}) {
  if (!supabaseConfig()) return <HostProblem state="unconfigured" />;
  const { confirm, email } = await searchParams;
  const notice = emailNotice(email);
  return (
    <main>
      <p className="wordmark">Debrio</p>
      <h1>Sign in</h1>
      {notice && <p role="status">{notice}</p>}
      {confirm === "failed" && (
        <p role="status">
          That link didn&apos;t sign you in. It may have expired, been used
          already or been opened in another browser. If your address is
          confirmed, sign in below. Otherwise create your account again to get a
          new link.
        </p>
      )}
      <Form
        action={signIn}
        submit="Sign in"
        fields={[
          {
            name: "email",
            label: "Email",
            type: "email",
            autoComplete: "email",
          },
          {
            name: "password",
            label: "Password",
            type: "password",
            autoComplete: "current-password",
          },
        ]}
      />
      <p>
        <Link href="/forgot-password">Forgot your password?</Link>
      </p>
      <p>
        New to Debrio? <Link href="/sign-up">Create an account</Link>
      </p>
    </main>
  );
}
