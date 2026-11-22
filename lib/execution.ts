import type { InputPreview } from "./inputs";
import type { Activity } from "./agenda";
import type { GroupCoordination } from "./group-work";

export type Execution = {
  session_id: string;
  state: "ready" | "live" | "paused" | "completed";
  revision: number;
  version_number: number;
  current: Activity | null;
  next: Activity | null;
  started_at: string | null;
  deadline: string | null;
  ended_at: string | null;
  remaining_seconds: number | null;
  session_seconds: number | null;
  elapsed_seconds: number | null;
  planned_before_minutes: number;
  planned_minutes: number;
  completed_count: number;
  activity_count: number;
  blockers: string[];
  context?: string;
  inputs?: InputPreview | null;
  ttl_ms?: number;
  coordination?: GroupCoordination;
  group_blockers?: string[];
  unfinished?: { group: string; ordinal: number }[];
};

export const executionError = (message: string, details?: string) => {
  if (["unsupported_agenda", "start_blocked"].includes(message) && details)
    return details;
  return (
    Object.entries({
      input_unavailable: "Fixed inputs are temporarily unavailable.",
      input_prerequisite:
        "A required submitted source field is missing or needs explicit partial acceptance.",
      stale_execution:
        "The session changed in another tab. Review its current state before trying again.",
      invalid_transition:
        "That action is no longer available. Review the current session.",
      version_not_ready: "Choose a frozen ready version first.",
      operation_reused:
        "That request was already used for a different action. Reload and try again.",
      not_allowed:
        "Your access could not be verified. Sign in again or ask the host to restore your place.",
    }).find(([code]) => code === message)?.[1] ??
    "The session service is unavailable. Check the current state before trying again."
  );
};

export function scheduleVariance(state: Execution) {
  const currentSeconds = (state.current?.minutes ?? 0) * 60;
  const used = Math.max(
    0,
    Math.min(
      currentSeconds,
      currentSeconds - (state.remaining_seconds ?? currentSeconds)
    )
  );
  return Math.round(
    ((state.elapsed_seconds ?? 0) - state.planned_before_minutes * 60 - used) /
      60
  );
}
