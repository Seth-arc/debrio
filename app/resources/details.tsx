import type {
  ResourceCheck,
  ResourcePreview,
  ResourceRecipient,
  ResourceVersion,
} from "../../lib/resources";

export const EXTERNAL_LIMIT =
  "Debrio can stop further access through this app. It cannot recall copied URLs or control an opened external page or later destination changes.";

export function LinkCheckDetails({
  content,
  check,
}: {
  content: string;
  check: ResourceCheck | null;
}) {
  let host = "Unverified";
  try {
    host = new URL(content).hostname;
  } catch {
    /* A draft may be incomplete. */
  }
  return (
    <div>
      <p>
        Original URL: <span className="instructions">{content}</span>
      </p>
      <p>Canonical host: {host}</p>
      <p>
        Checked final destination:{" "}
        <span className="instructions">
          {check?.final_url ?? "Not checked"}
        </span>
      </p>
      <p>
        {check?.outcome === "reachable" || check?.outcome === "ok"
          ? `HTTP reachable, checked at ${check.checked_at}. This may still be a sign-in page.`
          : `HTTP check: ${check?.outcome ?? "not checked"}.`}
      </p>
      <p>
        Host reviewed destination: {check?.reviewed ? "Yes" : "Not confirmed"}.
      </p>
      <p>{EXTERNAL_LIMIT}</p>
    </div>
  );
}

export function ResourceVersionDetails({
  version,
}: {
  version: ResourceVersion;
}) {
  return (
    <div>
      <h4>
        {version.title} · version {version.ordinal}
      </h4>
      <p>
        {version.kind === "text"
          ? "Plain text · Read-only"
          : version.kind === "file"
            ? "Protected file · Read-only"
            : "External HTTPS link"}
      </p>
      {version.kind === "text" ? (
        <p className="instructions" data-resource-content>
          {version.content}
        </p>
      ) : version.kind === "file" ? (
        <p>
          {version.file?.filename ?? "File unavailable"} · {version.file?.mime}{" "}
          · {version.file?.size} bytes · {version.file?.status}
        </p>
      ) : (
        <LinkCheckDetails content={version.content} check={version.check} />
      )}
    </div>
  );
}

export function ResourceBases({
  bases,
  participant = false,
}: {
  bases: ResourceRecipient["bases"];
  participant?: boolean;
}) {
  return (
    <>
      {bases
        .map((basis) =>
          basis.kind === "group"
            ? participant
              ? "Session group at release"
              : `Group ${basis.group} (membership ${basis.interval})`
            : basis.kind === "shared"
              ? "Shared — current admitted participants"
              : "Named individual"
        )
        .join("; ")}
    </>
  );
}

export function ResourcePreviewDetails({
  preview,
}: {
  preview: ResourcePreview;
}) {
  return (
    <div>
      {preview.version && <ResourceVersionDetails version={preview.version} />}
      <p>
        Release: {preview.trigger}
        {preview.activity ? ` · activity ${preview.activity}` : ""}. Recipients
        are fixed at confirmation. Later arrivals and group members need a new
        audience preview.
      </p>
      {preview.problems.length > 0 && (
        <ul>
          {preview.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      <h4>Named recipients</h4>
      <ul>
        {preview.recipients.map((person) => (
          <li key={person.participant}>
            {person.name} · {person.participant} · {person.change} ·{" "}
            <ResourceBases bases={person.bases} />
          </li>
        ))}
      </ul>
      {!!preview.excluded?.length && (
        <>
          <h4>Selected people excluded from this release</h4>
          <ul>
            {preview.excluded.map((person) => (
              <li key={person.participant}>
                {person.name} · {person.participant} · {person.reason}
              </li>
            ))}
          </ul>
          <p>
            Previous recipient revocations remain in effect. Restoring access
            requires explicit named restoration in a fresh audience preview.
          </p>
        </>
      )}
      {preview.lost.length > 0 && (
        <>
          <h4>Access withdrawn</h4>
          <ul>
            {preview.lost.map((person) => (
              <li key={person.participant}>
                {person.name} · {person.participant}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
