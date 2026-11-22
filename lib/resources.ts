export type ResourceKind = "text" | "link";
export type ResourceSelector = {
  kind: "individual" | "group" | "shared";
  id: string | null;
};
export type ResourceCheck = {
  id: string;
  outcome: string;
  checked_at: string | null;
  expires_at: string | null;
  final_url: string | null;
  reviewed: boolean;
};
export type ResourceVersion = {
  id: string;
  resource: string;
  ordinal: number;
  title: string;
  kind: ResourceKind;
  content: string;
  ready_at: string;
  check: ResourceCheck | null;
};
export type ResourceDraft = {
  id: string;
  revision: number;
  title: string;
  kind: ResourceKind;
  content: string;
  check: ResourceCheck | null;
  versions: ResourceVersion[];
  next_version_offset?: number | null;
};
export type ResourceLibrary = {
  workspace: string;
  enabled: boolean;
  ttl_ms: number;
  items: { id: string; revision: number; title: string; kind: ResourceKind }[];
  next_offset: number | null;
  resource: ResourceDraft | null;
  authority?: {
    resource: string;
    revision: number;
    versions: string[];
    next_version_offset: number | null;
  } | null;
};
export type ResourceLibraryCommand =
  | {
      command: "save";
      resource: string;
      revision: number;
      title: string;
      kind: ResourceKind;
      content: string;
    }
  | { command: "ready"; resource: string; revision: number }
  | { command: "approve_check"; check: string; reviewed: true };
export type ResourceProposal = {
  command: "schedule" | "release" | "audience";
  allocation: string;
  revision: number;
  version: string;
  trigger: "start" | "activity" | "manual";
  activity: string | null;
  selectors: ResourceSelector[];
  restore: string[];
  reason: string;
};
export type ResourceRecipient = {
  participant: string;
  name: string;
  bases: {
    kind: "individual" | "group" | "shared";
    group: string | null;
    interval: string | null;
  }[];
  change: "new" | "continuing" | "withdrawn";
  generation?: number;
  delivery?: string;
};
export type ResourcePreview = {
  token: string;
  ttl_ms?: number;
  allocation: string;
  revision: number;
  version: ResourceVersion | null;
  trigger: string;
  activity: string | null;
  recipients: ResourceRecipient[];
  lost: ResourceRecipient[];
  excluded: { participant: string; name: string; reason: string }[];
  problems: string[];
  request: ResourceProposal;
};
export type ResourceCommand =
  | (ResourceProposal & { token: string })
  | {
      command: "revoke";
      allocation: string;
      participant: string | null;
      reason: string;
    }
  | { command: "cancel"; allocation: string; revision: number }
  | { command: "retry"; allocation: string; participants: string[] }
  | { command: "ack" | "dismiss"; allocation: string; generation: number };
export type ResourceItem = {
  allocation: string;
  revision: number;
  version: string;
  title: string;
  kind: ResourceKind;
  ordinal: number;
  trigger: string;
  activity: string | null;
  released_at: string | null;
  revoked_at: string | null;
  selectors?: ResourceSelector[];
  bases?: ResourceRecipient["bases"];
  generation?: number;
  notice?: {
    id: string;
    generation: number;
    dismissed: boolean;
    received: boolean;
  };
  recipients?: ResourceRecipient[];
};
export type ResourceSnapshot = {
  session: string;
  actor: string;
  endpoint: string;
  ttl_ms: number;
  enabled: boolean;
  items: ResourceItem[];
  next_offset: number | null;
  detail:
    (ResourceItem & { content: string; check: ResourceCheck | null }) | null;
  participants?: { id: string; name: string }[];
  groups?: { id: string; ordinal: number }[];
  activities?: { id: string; title: string }[];
  workspace?: string;
  state?: string;
};
export type ResourceReply = {
  snapshot?: ResourceSnapshot;
  library?: ResourceLibrary;
  preview?: ResourcePreview;
  previewAuthority?: { token: string; ttl_ms: number };
  receipt?: {
    committed: boolean;
    resource?: string;
    revision?: number;
    version?: string;
  };
  error?: string;
  uncertain?: boolean;
};
export function resourceError(code: string) {
  return (
    Object.entries({
      not_allowed: "Resource access could not be verified.",
      resource_conflict:
        "This resource changed in another tab. Your edits are still here.",
      stale_resource: "This preview changed. Preview again before confirming.",
      resource_unavailable: "Resource changes are temporarily unavailable.",
      resource_prerequisite:
        "Resolve the resource preview problems before confirming.",
      resource_closed:
        "This session is closed for resource releases or audience changes.",
      invalid_resource: "Check the resource fields and limits.",
      operation_reused:
        "This retry belongs to another action. Review the current state.",
      resource_check_required:
        "Validate and review this exact link before continuing.",
      resource_check_limited:
        "Link checks are limited to ten per minute. Try again in a minute.",
    }).find(([key]) => key === code)?.[1] ??
    "Resources are unavailable. Previously fetched resources are hidden until access is verified."
  );
}
