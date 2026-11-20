import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { guestCookieName, hasLivePlace, isJoinKey } from "../../../lib/guest";
import { guestSupabase } from "../../../lib/supabase";
import { Form } from "../../form";
import { HostProblem } from "../../host-problem";
import { requestAdmission } from "../actions";

// Who may join is decided per request; never prerender.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Join a session · Debrio" };

function Closed({ heading, text }: { heading: string; text: string }) {
  return (
    <main>
      <p className="wordmark">Debrio</p>
      <h1>{heading}</h1>
      <p role="status">{text}</p>
    </main>
  );
}

export default async function Join({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const guest = guestSupabase();
  if (!guest) return <HostProblem state="unconfigured" />;
  const found = isJoinKey(key)
    ? await guest.rpc("session_for_join", { p_key: key })
    : { data: [], error: null };
  if (found.error)
    return (
      <Closed
        heading="Joining is unavailable"
        text="We couldn't reach the session service. Try again shortly."
      />
    );
  const session = (
    found.data as {
      id: string;
      title: string;
      state: string;
      locked: boolean;
      can_return: boolean;
    }[]
  )[0];
  if (!session)
    return (
      <Closed
        heading="This link doesn't work"
        text="It may have been replaced. Ask your host for the current session link."
      />
    );

  // The same browser already asked and is waiting or in: carry on there.
  if (
    await hasLivePlace(
      guest,
      session.id,
      (await cookies()).get(guestCookieName(session.id))?.value
    )
  )
    redirect(`/s/${session.id}`);

  const nameField = {
    name: "name",
    label: "Your name",
    autoComplete: "name",
    maxLength: 60,
    hint: "How you'd like to appear to the host and others.",
  };
  // A closed lobby or an ended session still lets someone who was already in
  // ask the host to restore their place.
  const returnOnly =
    session.state === "ended" ? session.can_return : session.locked;
  if (session.state === "ended" && !returnOnly)
    return (
      <Closed heading="This session has ended" text="Thanks for coming." />
    );
  if (returnOnly)
    return (
      <main>
        <p className="wordmark">Debrio</p>
        <h1>
          {session.state === "ended"
            ? "This session has ended"
            : `The lobby for ${session.title} is closed`}
        </h1>
        <p>
          If you were already in {session.title} and lost your place, for
          example by changing devices, ask the host to restore it. New people
          can&apos;t join right now.
        </p>
        <Form
          action={requestAdmission}
          submit="Ask the host to restore my place"
          hidden={{ key, returning: "yes" }}
          fields={[nameField]}
        />
      </main>
    );

  return (
    <main>
      <p className="wordmark">Debrio</p>
      <h1>Join {session.title}</h1>
      <p>
        You don&apos;t need an account. The host will see the name you enter and
        let you in.
      </p>
      <Form
        action={requestAdmission}
        submit="Ask to join"
        hidden={{ key }}
        fields={[
          nameField,
          {
            name: "returning",
            label: "I was already in this session",
            type: "checkbox",
            hint: "For example, if you changed devices. The host will restore your place.",
          },
        ]}
      />
    </main>
  );
}
