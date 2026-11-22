import type { Activity } from "./agenda";
import type { WorkAttempt } from "./work";

export type GroupMember = { participant: string; name: string; group: string };
export type GroupCoordination = {
  execution: number;
  assignment: number;
  roster: (Omit<GroupMember, "group"> & { group: string | null })[];
  recorders: {
    group: string;
    ordinal: number;
    recorder: string | null;
    revision: number;
  }[];
};
export type Contribution = {
  id: string;
  author_id: string;
  field_id: string;
  revision: number;
  content: string;
  saved_at: string;
};
export type FieldLineage = {
  revision: number;
  editor: string;
  authors: string[];
  sources: string[];
};
export type GroupAttempt = WorkAttempt & {
  audience: string[];
  restricted_predecessor?: boolean;
  snapshot: {
    version: string;
    schema: Activity["outputs"];
    lineage: Record<string, FieldLineage>;
    sources: Contribution[];
    contributions: Contribution[];
    roster: Omit<GroupMember, "group">[];
    context: GroupCoordination;
    window_revision: number;
  };
};
export type GroupWorkItem = {
  group: string;
  group_ordinal: number;
  activity: Activity;
  attempts: GroupAttempt[];
} & (
  | { draft_access: false }
  | {
      draft_access: true;
      revision: number;
      token: string;
      content: Record<string, string>;
      lineage: Record<string, FieldLineage>;
      sources: Contribution[];
      saved_at: string | null;
      window_revision: number;
      reopened: boolean;
      contributions: Contribution[];
      recorder: string | null;
      writable: boolean;
      predecessor:
        { id: string; ordinal: number } | { restricted: true } | null;
    }
);
export type GroupDraft = Extract<GroupWorkItem, { draft_access: true }>;
export type GroupWorkSnapshot = {
  session: string;
  version: string;
  actor: string | null;
  enabled: boolean;
  context: string;
  state: "ready" | "live" | "paused" | "completed";
  current: Activity | null;
  items: GroupWorkItem[];
  group: string | null;
  coordination: GroupCoordination | null;
  members: GroupMember[];
  recorder_history:
    | {
        id: string;
        group_id: string;
        old_recorder: string | null;
        new_recorder: string | null;
        reason: string;
        created_at: string;
      }[]
    | null;
};
export type GroupWorkCommand = {
  command:
    | "contribute"
    | "answer"
    | "replace_field"
    | "submit"
    | "submit_incomplete"
    | "accept_partial"
    | "reopen"
    | "close";
  group: string;
  activity: string;
  version: string;
  context: string;
  token: string;
  window_revision: number;
  reason: string;
  revision?: number;
  field?: string;
  value?: string;
  content?: Record<string, string>;
  sources?: Record<string, string[]>;
  audience?: string[];
  baseline?: string | null;
};
export type RecorderCommand = {
  command: "recorder";
  group: string;
  recorder: string | null;
  context: string;
  reason: string;
};
export type GroupWorkReply = {
  snapshot?: GroupWorkSnapshot | null;
  receipt?: {
    committed?: boolean;
    attempt?: string | null;
    confirmed_at: string;
  };
  error?: string;
  uncertain?: boolean;
};
export function groupWorkError(code: string) {
  switch (code) {
    case "input_access_required":
      return "Input access needs host confirmation. Your own text is still here.";
    case "not_allowed":
      return "Access changed. Your local text stays here; this work is no longer available.";
    case "group_work_conflict":
      return "Conflict: compare the current saved work and refresh the preview before continuing.";
    case "group_work_closed":
      return "Closed or temporarily unavailable for changes. Your local text stays here.";
    case "field_reset_required":
      return "Use Replace field and reset sources to clear an answer or remove its earlier attribution.";
    case "incomplete_work":
      return "Save a nonempty group answer. Complete every field, or submit incomplete work with a reason.";
    case "invalid_group_work":
      return "Check the selected field, sources, audience, reason and text limits.";
    case "operation_reused":
      return "This operation does not match its original request. Preserve your local text.";
    default:
      return "Service unavailable. A pending change may have committed; retry its exact request.";
  }
}
