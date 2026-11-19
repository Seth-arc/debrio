import { createClient } from "@supabase/supabase-js";
import { expect } from "vitest";
import {
  LOCAL_ANON_KEY,
  LOCAL_SUPABASE_URL,
} from "../../scripts/local-supabase";
import {
  confirmationLink,
  SYNTHETIC_PASSWORD,
  syntheticEmail,
} from "./local-auth";
import { totp } from "./totp";

// Integration-test hosts with real Auth tokens against the local stack.
export const client = (accessToken?: string) =>
  createClient(LOCAL_SUPABASE_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: accessToken
      ? { headers: { Authorization: `Bearer ${accessToken}` } }
      : undefined,
  });

// Real sign-up, emailed confirmation and password sign-in: an AAL1 session.
export async function confirmedHost() {
  const email = syntheticEmail();
  const host = client();
  expect(
    (await host.auth.signUp({ email, password: SYNTHETIC_PASSWORD })).error
  ).toBeNull();
  const verify = await fetch(await confirmationLink(email), {
    redirect: "manual",
  });
  expect(verify.status).toBe(303);
  const { data, error } = await host.auth.signInWithPassword({
    email,
    password: SYNTHETIC_PASSWORD,
  });
  expect(error).toBeNull();
  return { host, userId: data.user!.id, email };
}

// Enrolls TOTP and upgrades the session to AAL2, as a workspace owner must.
export async function ownerWithMfa() {
  const signedIn = await confirmedHost();
  const { data: factor, error } = await signedIn.host.auth.mfa.enroll({
    factorType: "totp",
  });
  expect(error).toBeNull();
  const verified = await signedIn.host.auth.mfa.challengeAndVerify({
    factorId: factor!.id,
    code: totp(factor!.totp.secret),
  });
  expect(verified.error).toBeNull();
  return signedIn;
}
