import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isSessionId } from "../../../lib/guest";
import { currentHost } from "../../../lib/supabase";
import { AutoRefresh } from "../../auto-refresh";
import { HostProblem } from "../../host-problem";
import { updateSession } from "../actions";

// The host's live view of one session; reads are limited by row policies.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Session · Debrio" };

const NOTICES = {
  ended: "That session has already ended.",
  changed:
    "Someone's status changed before your action arrived. The list below is current.",
  unavailable:
    "The session service is unavailable, so nothing was changed. Try again.",
};

type Participant = {
  id: string;
  display_name: string;
  state: string;
  requested_at: string;
};

function Command({
  session,
  command,
  participant,
  label,
  children,
  secondary,
}: {
  session: string;
  command: string;
  participant?: string;
  label?: string;
  children: string;
  secondary?: boolean;
}) {
  return (
    <form action={updateSession} className="inline">
      <input type="hidden" name="session" value={session} />
      <input type="hidden" name="command" value={command} />
      {participant && (
        <input type="hidden" name="participant" value={participant} />
      )}
      <button
        type="submit"
        aria-label={label}
        className={secondary ? "secondary" : undefined}
      >
        {children}
      </button>
    </form>
  );
}

export default async function HostSession({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { id } = await params;
  const host = await currentHost();
  if (host.state === "signed-out") redirect("/sign-in");
  if (host.state === "aal1") redirect("/mfa");
  if (host.state !== "aal2") return <HostProblem state={host.state} />;
  if (!isSessionId(id)) notFound();
  const [sessionResult, peopleResult] = await Promise.all([
    host.supabase
      .from("sessions")
      .select("id, title, state, locked, join_key")
      .eq("id", id)
      .maybeSingle(),
    host.supabase
      .from("session_participants")
      .select("id, display_name, state, requested_at")
      .eq("session_id", id)
      .order("requested_at"),
  ]);
  if (sessionResult.error || peopleResult.error)
    return (
      <main>
        <p className="wordmark">Debrio</p>
        <h1>Session service unavailable</h1>
        <p role="status">We couldn&apos;t load this session. Retrying…</p>
        <AutoRefresh seconds={3} />
      </main>
    );
  const session = sessionResult.data;
  if (!session) notFound();
  const people = peopleResult.data as Participant[];
  const waiting = people.filter(({ state }) => state === "waiting");
  const admitted = people.filter(({ state }) => state === "admitted");
  const { notice: noticeKey } = await searchParams;
  const notice = Object.entries(NOTICES).find(
    ([key]) => key === noticeKey
  )?.[1];
  const request = await headers();
  const link = `${request.get("x-forwarded-proto") ?? "http"}://${request.get("host")}/join/${session.join_key}`;
  const open = session.state === "open";

  return (
    <main>
      <p className="wordmark">Debrio</p>
      <p>
        <Link href="/workspace">Back to your workspace</Link>
      </p>
      <h1>{session.title}</h1>
      <p role="status">
        {open
          ? `${waiting.length} waiting · ${admitted.length} in the session · lobby ${
              session.locked ? "closed" : "open"
            }`
          : "This session has ended."}
      </p>
      {notice && <p role="alert">{notice}</p>}

      {open && (
        <section aria-labelledby="link-heading">
          <h2 id="link-heading">Join link</h2>
          <label htmlFor="join-link">Share this link with participants</label>
          <input id="join-link" readOnly value={link} />
          <div className="actions">
            <Command
              session={session.id}
              command={session.locked ? "unlock" : "lock"}
              secondary
            >
              {session.locked ? "Reopen the lobby" : "Close the lobby"}
            </Command>
            <Command session={session.id} command="replace" secondary>
              Replace link
            </Command>
          </div>
        </section>
      )}

      <section aria-labelledby="waiting-heading">
        <h2 id="waiting-heading">Waiting ({waiting.length})</h2>
        {waiting.length === 0 ? (
          <p>Nobody is waiting.</p>
        ) : (
          <ul className="people">
            {waiting.map((person) => (
              <li key={person.id}>
                <span>{person.display_name}</span>
                {open && (
                  <span className="actions">
                    <Command
                      session={session.id}
                      command="admit"
                      participant={person.id}
                      label={`Admit ${person.display_name}`}
                    >
                      Admit
                    </Command>
                    <Command
                      session={session.id}
                      command="deny"
                      participant={person.id}
                      label={`Deny ${person.display_name}`}
                      secondary
                    >
                      Deny
                    </Command>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="admitted-heading">
        <h2 id="admitted-heading">In the session ({admitted.length})</h2>
        {admitted.length === 0 ? (
          <p>Nobody has been let in yet.</p>
        ) : (
          <ul className="people">
            {admitted.map((person) => (
              <li key={person.id}>
                <span>{person.display_name}</span>
                {open && (
                  <Command
                    session={session.id}
                    command="remove"
                    participant={person.id}
                    label={`Remove ${person.display_name}`}
                    secondary
                  >
                    Remove
                  </Command>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {open && (
        <details>
          <summary>End session…</summary>
          <p>
            Ending is final: the link stops working and everyone sees that the
            session has ended.
          </p>
          <Command session={session.id} command="end">
            End session now
          </Command>
        </details>
      )}
      {open && <AutoRefresh seconds={3} />}
    </main>
  );
}
