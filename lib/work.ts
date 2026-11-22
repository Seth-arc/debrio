import type { Activity } from "./agenda";

export type WorkAttempt = {
  id: string;
  ordinal: number;
  preceding_id: string | null;
  submitted_by: string;
  draft_revision: number;
  content: Record<string, string>;
  missing: string[];
  reason: string;
  submitted_at: string;
  acceptance: { reason: string; accepted_at: string; actor_id: string } | null;
};
export type WorkItem = {
  participant: string;
  name: string;
  activity: Activity;
  index: number;
  revision: number;
  content: Record<string, string>;
  saved_at: string | null;
  latest: number;
  window_revision: number;
  reopened: boolean;
  writable: boolean;
  attempts: WorkAttempt[];
};
export type WorkSnapshot = {
  session: string;
  version: string;
  current_index: number;
  execution_revision: number;
  ended: boolean;
  items: WorkItem[];
};
export type WorkCommand = {
  command:
    | "save"
    | "submit"
    | "submit_incomplete"
    | "accept_partial"
    | "reopen"
    | "close";
  participant: string;
  activity: string;
  version: string;
  revision: number;
  latest: number;
  window_revision: number;
  reason: string;
  content?: Record<string, string>;
};
export type WorkReply = {
  snapshot?: WorkSnapshot | null;
  receipt?: {
    revision: number;
    latest: number;
    window_revision: number;
    attempt: string | null;
  };
  error?: string;
  uncertain?: boolean;
};

export const workText = (text: string) => text.replaceAll("\r\n", "\n");
export const validWorkText = (text: string, limit: number) =>
  text.isWellFormed() &&
  !text.includes("\0") &&
  Array.from(workText(text)).length <= limit;

export function workStatus(item: WorkItem) {
  const last = item.attempts.at(-1);
  if (!last)
    return item.revision ? "Saved draft · Not submitted" : "Not submitted";
  return last.missing.length === 0
    ? "Submitted complete"
    : last.acceptance
      ? "Accepted partial"
      : "Submitted incomplete — awaiting host acceptance";
}

export function workError(code: string) {
  switch (code) {
    case "input_access_required":
      return "Input access needs host confirmation. Your own text is still here.";
    case "not_allowed":
      return "Your access to this work is unavailable or has changed.";
    case "work_closed":
      return "This activity is closed for writing. Your text is still on this page.";
    case "work_conflict":
      return "Another change was saved. Compare the latest saved draft with your text before continuing.";
    case "operation_reused":
      return "This request does not match its original operation. Reload after preserving your text.";
    case "incomplete_work":
      return "Complete every answer, or explicitly submit nonempty incomplete work for review.";
    case "invalid_work":
      return "Check the answer limits, required details and selected work version.";
    default:
      return "Work service unavailable. The result may be unknown; retry the same request safely.";
  }
}
