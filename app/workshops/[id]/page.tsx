import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Agenda } from "../../../lib/agenda";
import { isUuid } from "../../../lib/ids";
import { currentHost } from "../../../lib/supabase";
import { HostProblem } from "../../host-problem";
import { OperationField } from "../../operation";
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
  revision: number;
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
      {command === "duplicate" && (
        <OperationField initial={crypto.randomUUID()} />
      )}
      <button
        type="submit"
        className="secondary"
        data-leave={command === "duplicate" ? "" : undefined}
      >
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
      <h2>Activities</h2>
      <ol className="activities">
        {agenda.activities.map((activity) => (
          <li key={activity.id}>
            <h3>{activity.title}</h3>
            <p>
              {activity.scope === "group"
                ? "Groups together"
                : "Each person alone"}{" "}
              · {activity.minutes} minutes
            </p>
            <p className="instructions">{activity.instructions}</p>
            <p>Produces: {activity.outputs.map((f) => f.label).join("; ")}</p>
            {activity.objectives.length > 0 && (
              <p>Serves: {activity.objectives.map(objective).join("; ")}</p>
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
  if (!isUuid(id)) notFound();
  const [workshopResult, versionsResult] = await Promise.all([
    host.supabase
      .from("workshops")
      .select("id, title")
      .eq("id", id)
      .maybeSingle(),
    host.supabase
      .from("workshop_versions")
      .select("id, number, state, content, revision, updated_at, ready_at")
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
  const { notice } = await searchParams;

  return (
    <main className="wide">
      <p className="wordmark">Debrio</p>
      <p>
        <Link href="/workspace" data-leave="">
          Back to your workspace
        </Link>
      </p>
      <h1>{workshop.title}</h1>
      {notice === "reused" && (
        <p role="alert">
          That Duplicate button had already been used, so nothing was copied.
          Use Duplicate again to make another copy.
        </p>
      )}
      {notice === "unavailable" && (
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
            revision={draft.revision}
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
