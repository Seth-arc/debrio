export type SessionGroup = { id: string; ordinal: number };
export type GroupMember = {
  participant: string;
  name: string;
  group: string | null;
};
export type GroupSnapshot = {
  session: string;
  version: string;
  revision: number;
  execution_revision: number;
  activity_index: number;
  state: "ready" | "live" | "paused" | "completed";
  members: GroupMember[];
  groups?: SessionGroup[];
  group?: SessionGroup | null;
  roster?: string;
  next_ordinal?: number;
  history?: {
    revision: number;
    reason: string;
    source: string;
    created_at: string;
    before_state: { members: { participant: string; group: string }[] };
    after_state: { members: { participant: string; group: string }[] };
  }[];
};
export type GroupPlan = {
  version: string;
  execution_revision: number;
  activity_index: number;
  revision: number;
  roster: string;
  groups: { key: string; create: boolean }[];
  retire: string[];
  members: { participant: string; group: string | null }[];
  reason: string;
};
export type GroupReply = {
  snapshot?: GroupSnapshot | null;
  receipt?: {
    revision: number;
    changed: boolean;
    groups: Record<string, string>;
    confirmed_at: string;
  };
  error?: string;
  uncertain?: boolean;
};

export function groupPlan(snapshot: GroupSnapshot): GroupPlan {
  return {
    version: snapshot.version,
    execution_revision: snapshot.execution_revision,
    activity_index: snapshot.activity_index,
    revision: snapshot.revision,
    roster: snapshot.roster!,
    groups: (snapshot.groups ?? []).map((g) => ({ key: g.id, create: false })),
    retire: [],
    members: snapshot.members.map((m) => ({
      participant: m.participant,
      group: m.group,
    })),
    reason: "",
  };
}
export function groupContextChanged(
  base: GroupSnapshot,
  current: GroupSnapshot
) {
  return (
    base.version !== current.version ||
    base.revision !== current.revision ||
    base.execution_revision !== current.execution_revision ||
    base.roster !== current.roster ||
    base.state !== current.state
  );
}

// Rejection sampling avoids modulo bias; confirmation sends this exact mapping.
function randomIndex(bound: number) {
  const limit = Math.floor(0x100000000 / bound) * bound;
  const value = new Uint32Array(1);
  do {
    crypto.getRandomValues(value);
  } while (value[0] >= limit);
  return value[0] % bound;
}
export function randomGroups(plan: GroupPlan): GroupPlan {
  if (
    !plan.groups.length ||
    plan.groups.length > 8 ||
    plan.members.length < plan.groups.length
  )
    throw new Error(
      "Create 1–8 groups, with at least one admitted person per group, before suggesting groups."
    );
  const people = plan.members.map((m) => m.participant);
  for (let i = people.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    // eslint-disable-next-line security/detect-object-injection -- bounded integer indices into the local shuffled array.
    [people[i], people[j]] = [people[j], people[i]];
  }
  return {
    ...plan,
    members: people.map((participant, i) => ({
      participant,
      group: plan.groups[i % plan.groups.length].key,
    })),
  };
}
export function groupError(code: string) {
  return (
    Object.entries({
      not_allowed:
        "Your access to group assignment has changed. Sign in again or ask the host to restore your place.",
      group_closed: "This session is closed for group changes.",
      group_conflict:
        "The roster, groups or activity changed. Your proposal is preserved; reconcile it with current state and preview again.",
      invalid_group_plan:
        "Check the complete allocation, group limits and reason before previewing again.",
      operation_reused:
        "This operation does not match its original request. Preserve your proposal before reloading.",
    }).find(([key]) => key === code)?.[1] ??
    "Group service unavailable. Current assignment is unconfirmed; retry safely."
  );
}

export function reconcileGroups(
  snapshot: GroupSnapshot,
  plan: GroupPlan
): GroupPlan {
  const fresh = groupPlan(snapshot);
  fresh.groups = [...fresh.groups, ...plan.groups.filter((g) => g.create)];
  const allowed = new Set(fresh.groups.map((g) => g.key));
  fresh.members = fresh.members.map((m) => {
    const local = plan.members.find((p) => p.participant === m.participant);
    return local && (!local.group || allowed.has(local.group)) ? local : m;
  });
  fresh.reason = plan.reason;
  return fresh;
}
