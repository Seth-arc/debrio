import type { Metadata } from "next";
import { cookies } from "next/headers";
import {
  credentialHash,
  guestCookieName,
  isSessionId,
} from "../../../lib/guest";
import { guestSupabase } from "../../../lib/supabase";
import { AutoRefresh } from "../../auto-refresh";
import { HostProblem } from "../../host-problem";

// A guest's place in a session, checked against the database on every request.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Session · Debrio" };

const PLACES = {
  waiting: {
    heading: "Waiting to be let in",
    text: (name: string) =>
      `Hi ${name}. The host will let you in soon. Keep this page open.`,
  },
  admitted: {
    heading: "You're in",
    text: (name: string) =>
      `Welcome, ${name}. Your facilitator will start the session soon.`,
  },
  denied: {
    heading: "Not let in",
    text: () =>
      "The host didn't let you in. If that was a mistake, open the session link again to ask.",
  },
  moved: {
    heading: "This place moved to another device",
    text: () =>
      "The host restored your place on another device, so this browser no longer has access. If that wasn't you, tell the host.",
  },
  removed: {
    heading: "Removed from the session",
    text: () =>
      "The host removed you from this session. If that was a mistake, open the session link again to ask.",
  },
};

export default async function GuestSession({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const guest = guestSupabase();
  if (!guest) return <HostProblem state="unconfigured" />;
  const credential = isSessionId(sessionId)
    ? (await cookies()).get(guestCookieName(sessionId))?.value
    : undefined;
  const result = credential
    ? await guest.rpc("guest_status", {
        p_session: sessionId,
        p_credential_hash: credentialHash(credential),
      })
    : { data: [], error: null };
  const place = (
    result.data as
      | {
          session_title: string;
          session_state: string;
          participant_state: string;
          display_name: string;
        }[]
      | null
  )?.[0];

  let heading: string;
  let text: string;
  let refresh = false;
  if (result.error) {
    heading = "Connection problem";
    text = "We couldn't check your place in the session. Retrying…";
    refresh = true;
  } else if (!place) {
    heading = "This page isn't available to you";
    text = "Open the session link your host shared to ask to join.";
  } else if (
    place.session_state === "ended" &&
    // A returning request still waits for the host; a moved place says so.
    !["waiting", "moved"].includes(place.participant_state)
  ) {
    heading = "This session has ended";
    text = "Thanks for coming.";
  } else {
    const shown =
      Object.entries(PLACES).find(
        ([state]) => state === place.participant_state
      )?.[1] ?? PLACES.removed;
    heading = shown.heading;
    text = shown.text(place.display_name);
    refresh =
      place.participant_state === "waiting" ||
      place.participant_state === "admitted";
  }
  return (
    <main>
      <p className="wordmark">Debrio</p>
      {place && <p>{place.session_title}</p>}
      <h1>{heading}</h1>
      <p role="status">{text}</p>
      {refresh && <AutoRefresh seconds={3} />}
    </main>
  );
}
