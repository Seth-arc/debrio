import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Agenda } from "../../../lib/agenda";
import { isSessionId as isId } from "../../../lib/guest";
import { currentHost } from "../../../lib/supabase";
import { HostProblem } from "../../host-problem";
import { workshopCommand } from "../actions";
import { AgendaEditor } from "./editor";

// Reads are limited by row policies; never prerender.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Workshop · Debrio" };

type Version = {
  id: string;
  number: number;
  state: "draft" | "ready";
  content: Agenda;
  updated_at: string;
  ready_at: string | null;
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }) + " UTC";

function Command({
  workshop,
  command,
  children,
}: {
  workshop: string;
  command: "new-draft" | "duplicate";
  children: string;
}) {
  return (
    <form action={workshopCommand} className="inline">
      <input type="hidden" name="workshop" value={workshop} />
      <input type="hidden" name="command" value={command} />
      <button type="submit" className="secondary">
        {children}
      </button>
    </form>
  );
}

function ReadOnlyAgenda({ agenda }: { agenda: Agenda }) {
  const objective = (id: string) =>
    agenda.objectives.find((o) => o.id === id)?.text ?? id;
  return (
    <>
      <h2>Objectives</h2>
      {agenda.objectives.length === 0 ? (
        <p>None.</p>
      ) : (
        <ol>
          {agenda.objectives.map((o) => (
            <li key={o.id}>{o.text}</li>
          ))}
        </ol>
      )}
      <h2>Stages</h2>
      <ol className="stages">
        {agenda.steps.map((stage) => (
          <li key={stage.id}>
            <h3>{stage.title}</h3>
            <p>
              {stage.scope === "group"
                ? "Groups together"
                : "Each person alone"}{" "}
              · {stage.minutes} minutes
            </p>
            <p className="instructions">{stage.instructions}</p>
            <p>Produces: {stage.outputs.map((f) => f.label).join("; ")}</p>
            {stage.objectives.length > 0 && (
              <p>Serves: {stage.objectives.map(objective).join("; ")}</p>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}

export default async function Workshop({
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
  if (!isId(id)) notFound();
  const [workshopResult, versionsResult] = await Promise.all([
    host.supabase
      .from("workshops")
      .select("id, title")
      .eq("id", id)
      .maybeSingle(),
    host.supabase
      .from("workshop_versions")
      .select("id, number, state, content, updated_at, ready_at")
      .eq("workshop_id", id)
      .order("number", { ascending: false }),
  ]);
  if (workshopResult.error || versionsResult.error)
    return (
      <main>
        <p className="wordmark">Debrio</p>
        <h1>Workshop service unavailable</h1>
        <p role="status">
          We couldn&apos;t load this workshop. Reload to try again.
        </p>
      </main>
    );
  const workshop = workshopResult.data;
  if (!workshop) notFound();
  const all = versionsResult.data as Version[];
  const draft = all.find(({ state }) => state === "draft");
  const latest = all[0];
  const problems = draft
    ? (((
        await host.supabase.rpc("workshop_problems", {
          p_content: draft.content,
        })
      ).data as string[] | null) ?? ["The readiness check is unavailable."])
    : [];
  const unavailable = (await searchParams).notice === "unavailable";

  return (
    <main className="wide">
      <p className="wordmark">Debrio</p>
      <p>
        <Link href="/workspace">Back to your workspace</Link>
      </p>
      <h1>{workshop.title}</h1>
      {unavailable && (
        <p role="alert">
          The workshop service is unavailable, so nothing was changed. Try
          again.
        </p>
      )}
      {draft ? (
        <>
          <p>
            Editing draft version {draft.number}.{" "}
            {all.some(({ state }) => state === "ready")
              ? "Ready versions stay unchanged."
              : "Mark it ready to run when it's complete."}
          </p>
          <AgendaEditor
            key={draft.id}
            versionId={draft.id}
            updatedAt={draft.updated_at}
            initial={draft.content}
            problems={problems}
          />
        </>
      ) : (
        <>
          <p role="status">
            Version {latest.number} is ready to run (since{" "}
            {when(latest.ready_at ?? latest.updated_at)}). It can no longer
            change.
          </p>
          <div className="actions">
            <Command workshop={workshop.id} command="new-draft">
              Create a new draft
            </Command>
          </div>
          <ReadOnlyAgenda agenda={latest.content} />
        </>
      )}
      <section aria-labelledby="versions-heading">
        <h2 id="versions-heading">Versions</h2>
        <ul>
          {all.map((version) => (
            <li key={version.id}>
              Version {version.number}:{" "}
              {version.state === "ready"
                ? `ready to run since ${when(version.ready_at ?? version.updated_at)}`
                : `draft, last saved ${when(version.updated_at)}`}
            </li>
          ))}
        </ul>
        <Command workshop={workshop.id} command="duplicate">
          Duplicate this workshop
        </Command>
      </section>
    </main>
  );
}
