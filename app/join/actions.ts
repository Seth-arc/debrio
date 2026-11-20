"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  credentialHash,
  GUEST_COOKIE_OPTIONS,
  guestCookieName,
  hasLivePlace,
  isJoinKey,
  newGuestCredential,
} from "../../lib/guest";
import {
  guestSupabase,
  serverSupabase,
  SIGN_IN_UNCONFIGURED,
} from "../../lib/supabase";
import type { FormState } from "../form";

const REFUSALS = {
  session_locked: "The host has closed the lobby for now. Try again shortly.",
  session_ended: "This session has ended.",
  unknown_link:
    "This link no longer works. Ask your host for the current session link.",
  lobby_full: "The lobby is busy right now. Try again in a minute.",
};

export async function requestAdmission(
  _: FormState,
  data: FormData
): Promise<FormState> {
  const rawKey = data.get("key");
  const key = typeof rawKey === "string" ? rawKey : "";
  if (!isJoinKey(key)) return { error: REFUSALS.unknown_link };
  const rawName = data.get("name");
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if ([...name].length < 1 || [...name].length > 60)
    return { error: "Enter a name of 1 to 60 characters." };
  const guest = guestSupabase();
  if (!guest) return { error: SIGN_IN_UNCONFIGURED };
  // A second tab or a resubmitted form must not replace a live place in the lobby.
  const existing = await guest.rpc("session_for_join", { p_key: key });
  const sessionForKey = (existing.data as { id: string }[] | null)?.[0]?.id;
  if (
    sessionForKey &&
    (await hasLivePlace(
      guest,
      sessionForKey,
      (await cookies()).get(guestCookieName(sessionForKey))?.value
    ))
  )
    redirect(`/s/${sessionForKey}`);
  const credential = newGuestCredential();
  // Signed-in visitors call with their own Auth session so the account is
  // recorded as evidence; everyone else is anonymous. Neither grants entry.
  const caller = await serverSupabase();
  if (!caller) return { error: SIGN_IN_UNCONFIGURED };
  const { data: sessionId, error } = await caller.rpc("request_admission", {
    p_key: key,
    p_display_name: name,
    p_credential_hash: credentialHash(credential),
    p_returning: data.get("returning") === "yes",
  });
  if (error)
    return {
      error:
        Object.entries(REFUSALS).find(
          ([code]) => code === error.message
        )?.[1] ??
        "Joining is unavailable right now. Nothing was sent to the host. Try again shortly.",
    };
  (await cookies()).set(
    guestCookieName(sessionId),
    credential,
    GUEST_COOKIE_OPTIONS
  );
  redirect(`/s/${sessionId}`);
}
