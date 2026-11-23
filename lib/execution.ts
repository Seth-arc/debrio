import type { InputPreview } from "./inputs";
import type { Activity } from "./agenda";
import type { GroupCoordination } from "./group-work";
import type { ResourcePreview } from "./resources";

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
  resources?: { items: ResourcePreview[]; problems: string[] } | null;
  resource_details?: boolean;
  ttl_ms?: number;
  coordination?: GroupCoordination;
  group_blockers?: string[];
  unfinished?: { group: string; ordinal: number }[];
};

// Initial HTML and background summaries do not carry unopened resource bodies or destinations.
export function executionResourceSummary(state: Execution): Execution {
  return {
    ...state,
    resource_details: false,
    resources: state.resources
      ? {
          ...state.resources,
          items: state.resources.items.map((item) => ({
            ...item,
            version: item.version
              ? {
                  ...item.version,
                  content: "",
                  check: item.version.check
                    ? { ...item.version.check, final_url: null }
                    : null,
                }
              : null,
          })),
        }
      : state.resources,
  };
}

export const executionError = (message: string, details?: string) => {
  if (["unsupported_agenda", "start_blocked"].includes(message) && details)
    return details;
  return (
    Object.entries({
      resource_prerequisite:
        "Resolve the scheduled resource problems before advancing.",
      stale_resource:
        "A resource preview changed. Preview the activity again before confirming.",
      resource_unavailable:
        "Resource changes are temporarily unavailable. Scheduled resources cannot be skipped.",
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
