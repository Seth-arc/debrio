import { GroupWorkPanel } from "../group-work-panel";
import { GroupPanel } from "../group-panel";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isSessionId } from "../../../lib/guest";
import { currentHost } from "../../../lib/supabase";
import { AutoRefresh } from "../../auto-refresh";
import { HostProblem } from "../../host-problem";
import { updateSession } from "../actions";
import type { Execution } from "../../../lib/execution";
import { ExecutionPanel } from "../execution-panel";
import { WorkPanel } from "../work-panel";
import { CommandButton } from "../command-button";

// The host's live view of one session; reads are limited by row policies.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Session · Debrio" };

const NOTICES = {
  ended: "That session has already ended.",
  changed:
    "Someone's status changed before your action arrived. The list below is current.",
  unavailable:
    "The session service is unavailable, so nothing was changed. Try again.",
  "restore-target":
    "That place can't be restored any more: the person you chose is no longer in the session. Choose someone else or admit them as new.",
};

type Participant = {
  id: string;
  display_name: string;
  state: string;
  is_return: boolean;
  requested_at: string;
  account_email: string | null;
};

// Shown next to a name so the host can verify who is asking; never a login.
function Evidence({ person }: { person: Participant }) {
  return (
    <>
      {person.is_return && <span className="tag">Returning</span>}
      {person.account_email && (
        <span className="hint">signed in as {person.account_email}</span>
      )}
    </>
  );
}

// The host picks which existing identity a verified returning person gets back.
function Restore({
  session,
  person,
  admitted,
}: {
  session: string;
  person: Participant;
  admitted: Participant[];
}) {
  const fieldId = `restore-${person.id}`;
  return (
    <form action={updateSession} className="inline restore">
      <input type="hidden" name="session" value={session} />
      <input type="hidden" name="command" value="restore" />
      <input type="hidden" name="participant" value={person.id} />
      <label htmlFor={fieldId}>Restore {person.display_name} as</label>
      <select id={fieldId} name="target" required>
        {admitted.map((place) => (
          <option key={place.id} value={place.id}>
            {place.display_name} (joined{" "}
            {new Date(place.requested_at).toLocaleString("en-GB", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "UTC",
            })}{" "}
            UTC)
          </option>
        ))}
      </select>
      <CommandButton>Restore</CommandButton>
    </form>
  );
}

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
      <CommandButton label={label} secondary={secondary}>
        {children}
      </CommandButton>
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
  const [sessionResult, peopleResult, executionResult] = await Promise.all([
    host.supabase
      .from("sessions")
      .select("id, title, state, locked, join_key")
      .eq("id", id)
      .maybeSingle(),
    host.supabase.rpc("session_people", { p_session: id }),
    host.supabase.rpc("host_execution_v2", { p_session: id }),
  ]);
  if (
    sessionResult.error ||
    (sessionResult.data && (peopleResult.error || executionResult.error))
  )
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
  const people = (peopleResult.data ?? []) as Participant[];
  const waiting = people.filter(({ state }) => state === "waiting");
  const admitted = people.filter(({ state }) => state === "admitted");
  const { notice: noticeKey } = await searchParams;
  const notice = Object.entries(NOTICES).find(
    ([key]) => key === noticeKey
  )?.[1];
  const request = await headers();
  const link = `${request.get("x-forwarded-proto") ?? "http"}://${request.get("host")}/join/${session.join_key}`;
  const execution = executionResult.data as Execution | null;
  const open = session.state === "open" && execution?.state !== "completed";
  // The database decides whether returning requests are still possible.
  const { data: joinable } = await host.supabase.rpc("session_for_join", {
    p_key: session.join_key,
  });
  const reviewOpen = Boolean(
    (joinable as { can_return: boolean }[] | null)?.[0]?.can_return
  );

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
          : `This session has ended.${
              waiting.length > 0
                ? ` ${waiting.length} waiting to be restored.`
                : ""
            }`}
      </p>
      {notice && <p role="alert">{notice}</p>}
      {execution && <ExecutionPanel initial={execution} host />}
      {execution && <GroupPanel session={id} host />}
      {execution && <WorkPanel session={id} host />}
      {execution && <GroupWorkPanel session={id} host />}

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
                <Evidence person={person} />
                <span className="actions">
                  {person.is_return && admitted.length > 0 && (
                    <Restore
                      session={session.id}
                      person={person}
                      admitted={admitted}
                    />
                  )}
                  {open && (
                    <Command
                      session={session.id}
                      command="admit"
                      participant={person.id}
                      label={
                        person.is_return
                          ? `Admit as new: ${person.display_name}`
                          : `Admit ${person.display_name}`
                      }
                    >
                      {person.is_return ? "Admit as new" : "Admit"}
                    </Command>
                  )}
                  {(open || person.is_return) && (
                    <Command
                      session={session.id}
                      command="deny"
                      participant={person.id}
                      label={`Deny ${person.display_name}`}
                      secondary
                    >
                      Deny
                    </Command>
                  )}
                </span>
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
                <Evidence person={person} />
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

      {open && !execution && (
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
      {/* Returning requests can arrive after the end, within the 90 days. */}
      {(open || reviewOpen) && <AutoRefresh seconds={3} />}
    </main>
  );
}
