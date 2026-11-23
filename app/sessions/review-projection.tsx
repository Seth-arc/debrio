import type { ReviewProjection } from "../../lib/reviews";

export function ReviewProjectionDetails({
  source,
}: {
  source: ReviewProjection;
}) {
  const label = (id: string) =>
    `${source.presentation.people.find((p) => p.id === id)?.name ?? "Contributor"} · ${id.slice(0, 8)}`;
  return (
    <div data-review-content>
      <p>
        {source.presentation.source_title} · submitted version {source.ordinal}{" "}
        · {source.presentation.owner_label} · {source.owner.slice(0, 8)}
      </p>
      <p>
        Submitted by {label(source.submitter)}.{" "}
        {source.partial
          ? "Explicitly accepted partial work."
          : "Complete submission."}
      </p>
      {source.fields.map((f) => (
        <div key={f.field.id}>
          <h4>{f.field.label}</h4>
          <p className="instructions">{f.value}</p>
          <p>Field authors: {f.authors.map(label).join(", ")}</p>
        </div>
      ))}
      <p>
        Read-only review. Access ends when this review closes, its activity ends
        or permission is withdrawn. Already seen or copied text cannot be
        recalled.
      </p>
    </div>
  );
}
