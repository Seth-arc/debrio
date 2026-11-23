import { isUuid } from "./ids";
import { validWorkText } from "./work";

export type ReviewProjection = {
  attempt: string;
  ordinal: number;
  source_activity: string;
  owner: string;
  kind: "individual" | "group";
  submitter: string;
  partial: boolean;
  presentation: {
    source_title: string;
    owner_label: string;
    people: { id: string; name: string }[];
  };
  fields: {
    field: { id: string; label: string; kind: "short" | "long" };
    value: string;
    authors: string[];
  }[];
};
export type ReviewProposal = {
  id: string;
  state: string;
  revision: number;
  activity: string;
  source: ReviewProjection | null;
  recipients: { id: string; name: string; revoked: boolean }[];
};
export type ReviewSnapshot = {
  session: string;
  actor: string;
  endpoint: string;
  enabled: boolean;
  ttl_ms: number;
  current: string | null;
  state: string;
  items: ReviewProposal[];
  next_offset: number | null;
  policies: {
    activity: string;
    group: string;
    policy: number;
    text: string;
    acknowledged: boolean;
    ready: boolean;
    pending: { id: string; name: string }[];
  }[];
  preview: {
    token: string;
    source: ReviewProjection | null;
    recipients: { id: string; name: string; state: string }[];
    problems: string[];
    newer_version: boolean;
  } | null;
  sources?: {
    id: string;
    ordinal: number;
    owner: string;
    owner_label: string;
    kind: string;
    activity: string;
    label: string;
    fields: { id: string; label: string; kind: string }[];
  }[];
  source_next_offset?: number | null;
  participants?: { id: string; name: string }[];
  activities?: { id: string; title: string; scope: string }[];
};
export type ReviewRequest = Record<string, unknown> & { command: string };
export type ReviewReply = {
  snapshot?: ReviewSnapshot;
  receipt?: { committed: boolean; proposal?: string };
  error?: string;
  uncertain?: boolean;
};
export function validReviewRequest(value: unknown): value is ReviewRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  const fields = {
    read: ["offset", "proposal", "source_offset"],
    create: ["proposal", "attempt", "fields", "recipients", "activity"],
    enable_policy: ["activity"],
    ack_policy: ["activity", "group", "policy"],
    request: ["proposal"],
    approve: ["proposal"],
    decline: ["proposal"],
    withdraw: ["proposal"],
    cancel: ["proposal"],
    release: ["proposal", "token"],
    close: ["proposal", "reason"],
    revoke: ["proposal", "participant", "reason"],
  };
  const keys = Object.entries(fields).find(([k]) => k === r.command)?.[1];
  if (!keys || Object.keys(r).some((k) => k !== "command" && !keys.includes(k)))
    return false;
  if (r.command !== "read" && keys.some((k) => !(k in r))) return false;
  for (const [key, v] of Object.entries(r)) {
    if (["proposal", "attempt", "group", "participant"].includes(key)) {
      if (typeof v !== "string" || !isUuid(v)) return false;
    } else if (key === "fields" || key === "recipients") {
      if (
        !Array.isArray(v) ||
        !v.length ||
        v.length > (key === "fields" ? 20 : 40) ||
        new Set(v).size !== v.length
      )
        return false;
      if (
        v.some(
          (s) =>
            typeof s !== "string" ||
            (key === "fields" ? !s || !validWorkText(s, 100) : !isUuid(s))
        )
      )
        return false;
    } else if (key === "offset" || key === "source_offset") {
      if (!Number.isSafeInteger(v) || (v as number) < 0) return false;
    } else if (key === "policy") {
      if (v !== 1) return false;
    } else if (key === "token") {
      if (typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v)) return false;
    } else if (key === "activity" || key === "reason") {
      if (
        typeof v !== "string" ||
        !v.trim() ||
        !validWorkText(v, key === "reason" ? 500 : 100)
      )
        return false;
    }
  }
  return true;
}
export function reviewError(code: string) {
  return (
    Object.entries({
      not_allowed:
        "Review access could not be verified. Protected material is hidden.",
      invalid_review:
        "Check the source, fields, reviewers and limits. Sources need valid sharing permission; self-review is not allowed.",
      stale_review: "This preview changed. Preview again before releasing.",
      review_prerequisite:
        "The source, approval or named reviewers are not ready for release.",
      review_unavailable: "New review sharing is temporarily unavailable.",
      review_closed:
        "This review is closed. A new assignment needs fresh permission.",
      review_disclosure_required:
        "Wait for every current group member to acknowledge the sharing rule before saving or submitting.",
      operation_reused: "This operation belongs to a different action.",
    }).find(([key]) => key === code)?.[1] ??
    "Review sharing is unavailable. Protected material is hidden until access is verified."
  );
}
