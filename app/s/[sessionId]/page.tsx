import { InputPanel } from "../../sessions/input-panel";
import { ResourcePanel } from "../../sessions/resource-panel";
import { ReviewPanel } from "../../sessions/review-panel";
import { GroupWorkPanel } from "../../sessions/group-work-panel";
import { GroupPanel } from "../../sessions/group-panel";
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
import type { Execution } from "../../../lib/execution";
import { WorkPanel } from "../../sessions/work-panel";
import { ExecutionPanel } from "../../sessions/execution-panel";

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
  const executionResult =
    credential && place?.participant_state === "admitted"
      ? await guest.rpc("guest_execution", {
          p_session: sessionId,
          p_credential_hash: credentialHash(credential),
        })
      : null;
  const execution = executionResult?.data as Execution | null;

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
    // After the end only returning requests still wait (others are turned away
    // when the session ends), and a moved place says so.
    !["waiting", "moved"].includes(place.participant_state)
  ) {
    heading = "This session has ended";
    text =
      place.participant_state === "admitted"
        ? `Your place as ${place.display_name} is on this device. Thanks for coming.`
        : "Thanks for coming.";
  } else {
    const shown =
      Object.entries(PLACES).find(
        ([state]) => state === place.participant_state
      )?.[1] ?? PLACES.removed;
    heading = shown.heading;
    text =
      execution && place.participant_state === "admitted"
        ? `Welcome, ${place.display_name}. Your place is on this device.`
        : shown.text(place.display_name);
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
      {execution && <ExecutionPanel initial={execution} />}
      {credential && execution && place?.participant_state === "admitted" && (
        <ReviewPanel
          key={`reviews:${credentialHash(credentialHash(credential))}`}
          session={sessionId}
          endpoint={credentialHash(credentialHash(credential))}
        />
      )}
      {credential && execution && place?.participant_state === "admitted" && (
        <ResourcePanel
          key={`resources:${credentialHash(credentialHash(credential))}`}
          session={sessionId}
          endpoint={credentialHash(credentialHash(credential))}
        />
      )}
      {credential && place?.participant_state === "admitted" && (
        <InputPanel
          key={credentialHash(credentialHash(credential))}
          session={sessionId}
          endpoint={credentialHash(credentialHash(credential))}
        />
      )}
      {credential && (
        <GroupPanel
          session={sessionId}
          enabled={place?.participant_state === "admitted"}
        />
      )}
      {credential && (
        <WorkPanel
          session={sessionId}
          enabled={place?.participant_state === "admitted"}
        />
      )}
      {credential && (
        <GroupWorkPanel
          session={sessionId}
          enabled={place?.participant_state === "admitted"}
        />
      )}
      {executionResult?.error && (
        <p role="alert">The current activity is unavailable. Retrying…</p>
      )}
      {refresh && <AutoRefresh seconds={3} />}
    </main>
  );
}
