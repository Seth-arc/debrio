import type { Activity, AnswerField } from "./agenda";

export const INPUT_SCOPE_CHANGED = "debrio-input-scope-changed";
// A newer access decision elsewhere on this page invalidates held input reads.
export function invalidateInputReads(session: string) {
  window.dispatchEvent(
    new CustomEvent(INPUT_SCOPE_CHANGED, { detail: session })
  );
}

export type InputField = {
  attempt: string;
  ordinal: number;
  source_activity: string;
  source_title: string;
  field: AnswerField;
  value: string;
  owner: string;
  kind: "individual" | "group";
  submitter: string;
  authors: string[];
  acceptance: {
    attempt: string;
    actor: string;
    reason: string;
    accepted_at: string;
  } | null;
};
export type InputPreview = {
  token: string;
  activity: string;
  problems: string[];
  candidates: {
    owner: string;
    label: string;
    binding: string | null;
    source: InputField | null;
    recipients: {
      participant: string;
      name: string;
      interval: string | null;
      granted: boolean;
    }[];
  }[];
};
export type InputSnapshot = {
  session: string;
  actor: string;
  endpoint: string;
  current: Activity | null;
  ttl_ms: number;
  preview: InputPreview | null;
  items: {
    binding: string;
    activity: string;
    grant: string | null;
    interval: string | null;
    source: InputField;
    grants:
      | {
          id: string;
          participant: string;
          interval: string | null;
          valid: boolean;
        }[]
      | null;
  }[];
};
export type InputCommand =
  | { command: "resolve"; token: string; reason: string }
  | {
      command: "revoke";
      binding: string;
      grant: string | null;
      reason: string;
    };
export type InputReply = {
  snapshot?: InputSnapshot;
  receipt?: { committed: boolean };
  error?: string;
  uncertain?: boolean;
};

export function inputError(code: string) {
  switch (code) {
    case "input_access_required":
      return "Input access needs host confirmation. Your own text is still here.";
    case "stale_input":
      return "This preview changed. Cancel and preview again before confirming.";
    case "input_prerequisite":
      return "A required source field is missing or needs explicit partial acceptance.";
    case "input_closed":
      return "This activity is closed. New input access cannot be granted.";
    case "input_unavailable":
      return "Fixed input changes are temporarily unavailable.";
    case "not_allowed":
      return "Input access could not be verified. Reconnect or ask the host to restore your access.";
    case "operation_reused":
      return "This request was used for another action. Reload and review the current state.";
    default:
      return "Input access is unavailable. Fetched input is hidden until access is verified again.";
  }
}

// A late response never gets a new five-second lease at receipt time.
export function inputReadDeadline(started: number, remaining: number) {
  return (
    started +
    Math.max(0, Math.min(5000, Number.isFinite(remaining) ? remaining : 0))
  );
}
