"use server";

import { isAuthError, isAuthRetryableFetchError } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  currentHost,
  serverSupabase,
  SIGN_IN_UNAVAILABLE,
  SIGN_IN_UNCONFIGURED,
} from "../../lib/supabase";
import type { FormState } from "../form";

const text = (data: FormData, name: string) => {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
};

const TOO_MANY = "Too many attempts. Wait a minute, then try again.";
const UNCONFIGURED = SIGN_IN_UNCONFIGURED;
const WRONG_CODE =
  "That code didn't match. Check the newest code in your authenticator app and your device's clock, then try again.";

function message(error: unknown, known: Record<string, string>) {
  if (isAuthRetryableFetchError(error)) return SIGN_IN_UNAVAILABLE;
  const code = isAuthError(error) ? error.code : undefined;
  return (
    Object.entries(known).find(([key]) => key === code)?.[1] ??
    "Something went wrong and nothing was changed. Try again."
  );
}

export async function signUp(_: FormState, data: FormData): Promise<FormState> {
  const email = text(data, "email").trim();
  const password = text(data, "password");
  // Auth rejects passwords over 72 bytes (its hashing limit) with a generic code.
  if (password.length < 12 || Buffer.byteLength(password) > 72)
    return { error: "Use a password of 12 to 72 characters." };
  const supabase = await serverSupabase();
  if (!supabase) return { error: UNCONFIGURED };
  // Next.js checks Origin against Host for actions; without it there is no safe link target.
  const origin = (await headers()).get("origin");
  if (!origin)
    return {
      error: "Something went wrong and nothing was changed. Try again.",
    };
  const { error } = await supabase.auth.signUp({
    email,
    password,
    // Auth only accepts redirect targets on its allow-list.
    options: { emailRedirectTo: `${origin}/auth/confirm` },
  });
  if (error)
    return {
      error: message(error, {
        weak_password: "Choose a longer, less common password.",
        email_address_invalid: "Enter a valid email address.",
        over_email_send_rate_limit: TOO_MANY,
        over_request_rate_limit: TOO_MANY,
      }),
    };
  redirect("/sign-up?sent=1");
}

export async function signIn(_: FormState, data: FormData): Promise<FormState> {
  const email = text(data, "email").trim();
  const supabase = await serverSupabase();
  if (!supabase) return { error: UNCONFIGURED };
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: text(data, "password"),
  });
  if (error)
    return {
      error: message(error, {
        invalid_credentials: "The email or password is incorrect.",
        email_not_confirmed:
          "Confirm your email address first, using the link we sent you.",
        over_request_rate_limit: TOO_MANY,
      }),
    };
  redirect("/mfa");
}

export type Enrollment =
  { factorId: string; qr: string; secret: string } | { error: string } | null;

export async function startEnrollment(): Promise<Enrollment> {
  const host = await currentHost();
  if (host.state === "unavailable") return { error: SIGN_IN_UNAVAILABLE };
  if (host.state !== "aal1" && host.state !== "aal2") redirect("/sign-in");
  // Adding a backup requires the existing authenticator first (Auth enforces this too).
  if (host.verifiedFactorIds.length > 0 && host.state !== "aal2")
    redirect("/mfa");
  // The accepted design is one authenticator plus one optional backup.
  if (host.verifiedFactorIds.length >= 2)
    return { error: "You already have a backup authenticator." };
  // Abandoned set-up attempts leave unverified factors; replace them.
  for (const factor of host.user.factors ?? [])
    if (factor.status === "unverified")
      await host.supabase.auth.mfa.unenroll({ factorId: factor.id });
  const { data, error } = await host.supabase.auth.mfa.enroll({
    factorType: "totp",
    issuer: "Debrio",
    friendlyName:
      host.verifiedFactorIds.length === 0
        ? "Authenticator"
        : `Backup authenticator ${host.verifiedFactorIds.length}`,
  });
  if (error)
    return {
      error: message(error, {
        too_many_enrolled_mfa_factors:
          "You already have the maximum number of authenticators.",
        insufficient_aal: "Enter your existing authenticator code first.",
      }),
    };
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

export async function verifyEnrollment(
  _: FormState,
  data: FormData
): Promise<FormState> {
  const host = await currentHost();
  if (host.state === "unavailable") return { error: SIGN_IN_UNAVAILABLE };
  if (host.state !== "aal1" && host.state !== "aal2") redirect("/sign-in");
  // Auth also checks the factor belongs to this user.
  const { error } = await host.supabase.auth.mfa.challengeAndVerify({
    factorId: text(data, "factorId"),
    code: text(data, "code").trim(),
  });
  if (error)
    return {
      error: message(error, {
        mfa_verification_failed: WRONG_CODE,
        mfa_challenge_expired: WRONG_CODE,
        mfa_factor_not_found: "Set-up expired. Reload the page to start again.",
        over_request_rate_limit: TOO_MANY,
      }),
    };
  redirect("/workspace");
}

export async function verifySignIn(
  _: FormState,
  data: FormData
): Promise<FormState> {
  const host = await currentHost();
  if (host.state === "unavailable") return { error: SIGN_IN_UNAVAILABLE };
  if (host.state === "aal2") redirect("/workspace");
  if (host.state !== "aal1") redirect("/sign-in");
  const code = text(data, "code").trim();
  let lastError: unknown;
  // A code can come from the main or a backup authenticator.
  for (const factorId of host.verifiedFactorIds) {
    const { error } = await host.supabase.auth.mfa.challengeAndVerify({
      factorId,
      code,
    });
    if (!error) redirect("/workspace");
    lastError = error;
  }
  return {
    error: message(lastError, {
      mfa_verification_failed: WRONG_CODE,
      mfa_challenge_expired: WRONG_CODE,
      over_request_rate_limit: TOO_MANY,
    }),
  };
}

export async function signOut() {
  const supabase = await serverSupabase();
  const result = await supabase?.auth.signOut({ scope: "local" });
  if (result?.error) {
    // Auth unreachable: still forget the session in this browser.
    const store = await cookies();
    for (const { name } of store.getAll())
      if (name.startsWith("sb-")) store.delete(name);
  }
  redirect("/");
}
