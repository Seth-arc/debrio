"use server";

import { isAuthError, isAuthRetryableFetchError } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  currentHost,
  hasFreshCode,
  serverSupabase,
  SIGN_IN_UNAVAILABLE,
  SIGN_IN_UNCONFIGURED,
  type SignedInHost,
} from "../../lib/supabase";
import type { FormState } from "../form";

const text = (data: FormData, name: string) => {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
};

const TOO_MANY = "Too many attempts. Wait a minute, then try again.";
const UNCONFIGURED = SIGN_IN_UNCONFIGURED;
const GENERIC = "Something went wrong and nothing was changed. Try again.";
const WRONG_CODE =
  "That code didn't match. Check the newest code in your authenticator app and your device's clock, then try again.";
// Auth times out when mail can't be sent, after possibly saving the change.
const MAIL_UNCERTAIN =
  "We couldn't confirm the email was sent. Wait a few minutes and check your inbox before trying again.";
const CODE_ERRORS = {
  mfa_verification_failed: WRONG_CODE,
  mfa_challenge_expired: WRONG_CODE,
  over_request_rate_limit: TOO_MANY,
};

function message(
  error: unknown,
  known: Record<string, string>,
  timedOut = SIGN_IN_UNAVAILABLE
) {
  // A 504 means Auth timed out mid-request (for example while sending mail);
  // other retryable errors mean Auth itself could not be reached.
  if (isAuthRetryableFetchError(error))
    return error.status === 504 ? timedOut : SIGN_IN_UNAVAILABLE;
  const code = isAuthError(error) ? error.code : undefined;
  return Object.entries(known).find(([key]) => key === code)?.[1] ?? GENERIC;
}

// Auth rejects passwords over 72 bytes (its hashing limit) with a generic code.
const passwordProblem = (password: string) =>
  password.length < 12 || Buffer.byteLength(password) > 72
    ? "Use a password of 12 to 72 characters. Accented letters and symbols count as more than one."
    : null;

// Next.js checks Origin against Host for actions; without it there is no safe link target.
// Auth only accepts link targets on its allow-list.
const siteOrigin = async () => (await headers()).get("origin");

// Only this literal is accepted, so no request value becomes a redirect target.
const destination = (data: FormData) =>
  text(data, "next") === "account" ? "/account" : "/workspace";

// A code can come from the main or a backup authenticator.
async function verifyAnyCode(host: SignedInHost, code: string) {
  let lastError: unknown;
  for (const factorId of host.verifiedFactorIds) {
    const { error } = await host.supabase.auth.mfa.challengeAndVerify({
      factorId,
      code,
    });
    if (!error) return null;
    lastError = error;
  }
  return lastError ?? new Error("No authenticator is set up.");
}

export async function signUp(_: FormState, data: FormData): Promise<FormState> {
  const email = text(data, "email").trim();
  const password = text(data, "password");
  const problem = passwordProblem(password);
  if (problem) return { error: problem };
  const supabase = await serverSupabase();
  if (!supabase) return { error: UNCONFIGURED };
  const origin = await siteOrigin();
  if (!origin) return { error: GENERIC };
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/auth/confirm` },
  });
  // A per-address resend limit only hits addresses that exist; answer as usual.
  if (isAuthError(error) && error.code === "over_email_send_rate_limit")
    redirect("/sign-up?sent=1");
  if (error)
    return {
      error: message(
        error,
        {
          weak_password: "Choose a longer, less common password.",
          email_address_invalid: "Enter a valid email address.",
          over_request_rate_limit: TOO_MANY,
        },
        MAIL_UNCERTAIN
      ),
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

export async function requestPasswordReset(
  _: FormState,
  data: FormData
): Promise<FormState> {
  const supabase = await serverSupabase();
  if (!supabase) return { error: UNCONFIGURED };
  const origin = await siteOrigin();
  if (!origin) return { error: GENERIC };
  // Auth answers the same for unknown addresses, so this reveals nothing while mail works.
  const { error } = await supabase.auth.resetPasswordForEmail(
    text(data, "email").trim(),
    { redirectTo: `${origin}/auth/confirm?flow=recovery` }
  );
  // Auth limits resends per address, which only happens for real accounts. A link
  // was sent recently, so answer exactly as for any other address.
  if (isAuthError(error) && error.code === "over_email_send_rate_limit")
    redirect("/forgot-password?sent=1");
  if (error)
    return {
      error: message(
        error,
        {
          email_address_invalid: "Enter a valid email address.",
          validation_failed: "Enter a valid email address.",
          over_request_rate_limit: TOO_MANY,
        },
        MAIL_UNCERTAIN
      ),
    };
  redirect("/forgot-password?sent=1");
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
        ...CODE_ERRORS,
        mfa_factor_not_found: "Set-up expired. Reload the page to start again.",
      }),
    };
  redirect(destination(data));
}

export async function verifySignIn(
  _: FormState,
  data: FormData
): Promise<FormState> {
  const host = await currentHost();
  if (host.state === "unavailable") return { error: SIGN_IN_UNAVAILABLE };
  if (host.state === "aal2") redirect(destination(data));
  if (host.state !== "aal1") redirect("/sign-in");
  const error = await verifyAnyCode(host, text(data, "code").trim());
  if (!error) redirect(destination(data));
  return { error: message(error, CODE_ERRORS) };
}

// AAL2 owner for the account page's actions; sensitive changes also need a
// code from the last 10 minutes, otherwise the page asks for one first.
async function accountOwner(needsFreshCode: boolean) {
  const host = await currentHost();
  if (host.state === "unavailable") return { error: SIGN_IN_UNAVAILABLE };
  if (host.state === "aal1") redirect("/mfa?next=account");
  if (host.state !== "aal2") redirect("/sign-in");
  if (needsFreshCode && !hasFreshCode(host.codeVerifiedAt))
    redirect("/account?status=recheck");
  return { host };
}

// Re-checks an AAL2 owner before a sensitive change (refreshes the code time).
export async function confirmIdentity(
  _: FormState,
  data: FormData
): Promise<FormState> {
  const owner = await accountOwner(false);
  if ("error" in owner) return owner;
  const error = await verifyAnyCode(owner.host, text(data, "code").trim());
  if (!error) redirect("/account");
  return { error: message(error, CODE_ERRORS) };
}

export async function changePassword(
  _: FormState,
  data: FormData
): Promise<FormState> {
  const password = text(data, "password");
  const problem = passwordProblem(password);
  if (problem) return { error: problem };
  const checked = await accountOwner(true);
  if ("error" in checked) return checked;
  const auth = checked.host.supabase.auth;
  const { error } = await auth.updateUser({ password });
  if (error)
    return {
      error: message(error, {
        same_password: "Choose a password different from your current one.",
        weak_password: "Choose a longer, less common password.",
        over_request_rate_limit: TOO_MANY,
      }),
    };
  // Auth (v2.198) already ends other sessions on a password change; this keeps the
  // guarantee explicit rather than relying on undocumented behaviour.
  const others = await auth.signOut({ scope: "others" });
  if (others.error)
    return {
      error:
        "Your password was changed, but your other devices couldn't be signed out. Change your password again to retry.",
    };
  redirect("/account?status=password-changed");
}

export async function changeEmail(
  _: FormState,
  data: FormData
): Promise<FormState> {
  const checked = await accountOwner(true);
  if ("error" in checked) return checked;
  const origin = await siteOrigin();
  if (!origin) return { error: GENERIC };
  // Auth sends a link to both the current and the new address; both must confirm.
  const { error } = await checked.host.supabase.auth.updateUser(
    { email: text(data, "email").trim() },
    { emailRedirectTo: `${origin}/auth/confirm?flow=email` }
  );
  if (error)
    return {
      error: message(
        error,
        {
          email_exists: "That address can't be used for this account.",
          email_address_invalid: "Enter a valid email address.",
          validation_failed: "Enter a valid email address.",
          over_email_send_rate_limit: TOO_MANY,
          over_request_rate_limit: TOO_MANY,
        },
        MAIL_UNCERTAIN
      ),
    };
  redirect("/account?email=sent");
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
