import type { SupabaseClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { client, confirmedHost, ownerWithMfa } from "../support/hosts";
import { SYNTHETIC_PASSWORD } from "../support/local-auth";

type Version = {
  id: string;
  number: number;
  state: string;
  content: Agenda;
  revision: number;
};
type Agenda = {
  objectives: { id: string; text: string }[];
  activities: Record<string, unknown>[];
};

const activity = (id: string, change: Record<string, unknown> = {}) => ({
  id,
  title: "Think alone",
  instructions: "Write what you would say first.",
  scope: "individual",
  minutes: 10,
  outputs: [{ id: "f1", label: "Your opening", kind: "long" }],
  input: null,
  objectives: ["o1"],
  ...change,
});

// A complete agenda: the second activity uses the first activity's answer.
const agenda = (): Agenda => ({
  objectives: [{ id: "o1", text: "Give specific feedback" }],
  activities: [
    activity("a1"),
    activity("a2", {
      title: "Compare in groups",
      instructions: "Agree on the strongest opening.",
      scope: "group",
      minutes: 20,
      outputs: [{ id: "f1", label: "Agreed opening", kind: "short" }],
      input: { activity: "a1", field: "f1" },
      objectives: [],
    }),
  ],
});

const withActivity = (
  index: number,
  change: Record<string, unknown>
): Agenda => {
  const result = agenda();
  return {
    ...result,
    activities: result.activities.map((item, i) =>
      i === index ? { ...item, ...change } : item
    ),
  };
};

async function ownerWithWorkshop(title = "Feedback practice") {
  const owner = await ownerWithMfa();
  expect(
    (await owner.host.from("workspaces").insert({ name: "Synthetic Practice" }))
      .error
  ).toBeNull();
  const { data, error } = await owner.host.rpc("create_workshop", {
    p_title: title,
    p_operation: randomUUID(),
  });
  expect(error).toBeNull();
  return { ...owner, workshopId: data.id as string };
}

const versions = async (host: SupabaseClient, workshopId: string) =>
  (
    await host
      .from("workshop_versions")
      .select("id, number, state, content, revision")
      .eq("workshop_id", workshopId)
      .order("number")
  ).data as Version[];

const save = (host: SupabaseClient, version: Version, content: unknown) =>
  host.rpc("save_workshop_draft", {
    p_version: version.id,
    p_expected_revision: version.revision,
    p_content: content,
  });

const ready = (host: SupabaseClient, version: Version) =>
  host.rpc("mark_workshop_ready", {
    p_version: version.id,
    p_expected_revision: version.revision,
  });

// Runs SQL as the database owner (no row policies) in the disposable database only.
function privilegedSql(sql: string) {
  return spawnSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      "postgres",
      "-tA",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: sql, encoding: "utf8" }
  );
}

describe("workshop agendas", { timeout: 60_000 }, () => {
  test("an agenda with objectives, activities and a linked input survives save, reload and reorder", async () => {
    const { host, workshopId } = await ownerWithWorkshop();
    const [draft] = await versions(host, workshopId);
    expect(draft).toMatchObject({ number: 1, state: "draft", revision: 1 });
    expect(draft.content).toEqual({ objectives: [], activities: [] });

    const saved = await save(host, draft, agenda());
    expect(saved.error).toBeNull();
    expect(saved.data.revision).toBe(2);
    expect((await versions(host, workshopId))[0].content).toEqual(agenda());

    const reordered = {
      ...agenda(),
      activities: [...agenda().activities].reverse(),
    };
    expect((await save(host, saved.data, reordered)).error).toBeNull();
    const stored = (await versions(host, workshopId))[0].content;
    expect(stored.activities.map(({ id }) => id)).toEqual(["a2", "a1"]);
  });

  // One row per readiness rule; each agenda breaks exactly that rule.
  const problems: [string, Agenda, string[]][] = [
    [
      "no activities",
      { ...agenda(), activities: [] },
      ["Add at least one activity."],
    ],
    [
      "duplicate activity ids",
      withActivity(1, { id: "a1" }),
      ["Objectives and activities need unique identifiers."],
    ],
    [
      "blank objective",
      { ...agenda(), objectives: [{ id: "o1", text: "  " }] },
      ["Objective 1 needs text."],
    ],
    [
      "blank title",
      withActivity(0, { title: " " }),
      ["Activity 1 needs a title."],
    ],
    [
      "blank instructions",
      withActivity(0, { instructions: "\n" }),
      ["Activity 1 needs instructions."],
    ],
    [
      "no answer fields",
      withActivity(1, { outputs: [] }),
      ["Activity 2 needs at least one answer field."],
    ],
    [
      "unlabelled answer field",
      withActivity(0, { outputs: [{ id: "f1", label: " ", kind: "long" }] }),
      ["Activity 1 has an answer field without a label."],
    ],
    [
      "duplicate answer fields",
      withActivity(1, {
        outputs: [
          { id: "f1", label: "One", kind: "short" },
          { id: "f1", label: "Two", kind: "long" },
        ],
      }),
      ["Activity 2 has duplicate answer fields."],
    ],
    [
      "input from a missing activity",
      withActivity(1, { input: { activity: "a9", field: "f1" } }),
      ["Activity 2 uses input from an activity that no longer exists."],
    ],
    [
      "input from itself",
      withActivity(0, { input: { activity: "a1", field: "f1" } }),
      ["Activity 1 can only use input from an earlier activity."],
    ],
    [
      "input from a later activity",
      withActivity(0, { input: { activity: "a2", field: "f1" } }),
      ["Activity 1 can only use input from an earlier activity."],
    ],
    [
      "input from a missing answer field",
      withActivity(1, { input: { activity: "a1", field: "f9" } }),
      ["Activity 2 uses an answer field that no longer exists."],
    ],
    [
      "link to a missing objective",
      withActivity(0, { objectives: ["o9"] }),
      ["Activity 1 links an objective that no longer exists."],
    ],
    ["exactly 240 minutes", withActivity(1, { minutes: 230 }), []],
    [
      "241 minutes",
      withActivity(1, { minutes: 231 }),
      [
        "The activities are planned for 241 minutes; a session lasts at most 240 minutes (4 hours).",
      ],
    ],
    ["complete", agenda(), []],
  ];

  test.each(problems)("readiness: %s", async (_, content, expected) => {
    const { host, workshopId } = await ownerWithWorkshop();
    const [draft] = await versions(host, workshopId);
    const saved = await save(host, draft, content);
    expect(saved.error).toBeNull();
    // The editor sees exactly the problems the freeze enforces.
    expect(
      (await host.rpc("workshop_problems", { p_content: content })).data
    ).toEqual(expected);
    const result = await ready(host, saved.data);
    if (expected.length === 0) {
      expect(result.error).toBeNull();
      expect(result.data.state).toBe("ready");
    } else {
      expect(result.error?.message).toBe("not_ready");
      expect(result.error?.details?.split("\n")).toEqual(expected);
    }
  });

  test("whole-number minutes written as 10.0 are checked, not rejected", () => {
    const content = JSON.stringify(agenda()).replace(
      '"minutes":10',
      '"minutes":10.0'
    );
    expect(content).toContain("10.0");
    const result = privilegedSql(
      `select coalesce(array_to_string(public.workshop_problems('${content}'::jsonb), '|'), 'error');`
    );
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("");
  });

  test("Ready to run freezes a version against every caller, including the database owner", async () => {
    const { host, workshopId } = await ownerWithWorkshop();
    const [draft] = await versions(host, workshopId);
    const complete = (await save(host, draft, agenda())).data;
    const frozen = await ready(host, complete);
    expect(frozen.error).toBeNull();
    expect(frozen.data.state).toBe("ready");

    expect((await save(host, frozen.data, agenda())).error?.message).toBe(
      "version_ready"
    );
    const directUpdate = await host
      .from("workshop_versions")
      .update({ content: { objectives: [], activities: [] } })
      .eq("id", complete.id);
    expect(directUpdate.error?.code).toBe("42501");
    const directDelete = await host
      .from("workshop_versions")
      .delete()
      .eq("id", complete.id);
    expect(directDelete.error?.code).toBe("42501");

    // Without row policies, the trigger still refuses.
    expect(complete.id).toMatch(/^[0-9a-f-]{36}$/);
    for (const sql of [
      `update public.workshop_versions set content = '{"objectives":[],"activities":[]}' where id = '${complete.id}';`,
      `delete from public.workshop_versions where id = '${complete.id}';`,
    ]) {
      const result = privilegedSql(sql);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("version_ready");
    }
    expect((await versions(host, workshopId))[0].content).toEqual(agenda());
  });

  test("editing after Ready to run starts one new draft and leaves the ready version alone", async () => {
    const { host, workshopId } = await ownerWithWorkshop();
    const [draft] = await versions(host, workshopId);
    await ready(host, (await save(host, draft, agenda())).data);

    // Two tabs ask for a new draft at once: both get the same one.
    const [one, two] = await Promise.all([
      host.rpc("new_workshop_draft", { p_workshop: workshopId }),
      host.rpc("new_workshop_draft", { p_workshop: workshopId }),
    ]);
    expect(one.error).toBeNull();
    expect(two.error).toBeNull();
    expect(two.data.id).toBe(one.data.id);
    expect(one.data).toMatchObject({ number: 2, state: "draft" });
    expect(one.data.content).toEqual(agenda());

    const changed = withActivity(0, { title: "Think alone, briefly" });
    expect((await save(host, one.data, changed)).error).toBeNull();
    const all = await versions(host, workshopId);
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ number: 1, state: "ready" });
    expect(all[0].content).toEqual(agenda());
    expect(all[1].content.activities[0].title).toBe("Think alone, briefly");
  });

  test("duplicating copies the configuration, and a retried operation returns the same copy", async () => {
    const { host, workshopId } = await ownerWithWorkshop("Coaching basics");
    const [draft] = await versions(host, workshopId);
    await save(host, draft, agenda());
    const operation = randomUUID();
    const duplicate = () =>
      host.rpc("duplicate_workshop", {
        p_workshop: workshopId,
        p_operation: operation,
      });
    const [copy, concurrent] = await Promise.all([duplicate(), duplicate()]);
    expect(copy.error).toBeNull();
    expect(concurrent.error).toBeNull();
    expect((await duplicate()).data.id).toBe(copy.data.id);
    expect(concurrent.data.id).toBe(copy.data.id);
    expect(copy.data.title).toBe("Copy of Coaching basics");
    const [copied] = await versions(host, copy.data.id);
    expect(copied).toMatchObject({ number: 1, state: "draft" });
    expect(copied.content).toEqual(agenda());
    expect(
      (await host.from("workshops").select("id").like("title", "Copy of %"))
        .data
    ).toHaveLength(1);
  });

  test("a retried create returns the same workshop, and an operation from another workspace is refused", async () => {
    const owner = await ownerWithWorkshop();
    const operation = randomUUID();
    const create = (host: SupabaseClient) =>
      host.rpc("create_workshop", {
        p_title: "Retried",
        p_operation: operation,
      });
    const [first, concurrent] = await Promise.all([
      create(owner.host),
      create(owner.host),
    ]);
    expect(first.error).toBeNull();
    expect(concurrent.data.id).toBe(first.data.id);
    expect((await create(owner.host)).data.id).toBe(first.data.id);
    expect(
      (await owner.host.from("workshops").select("id").eq("title", "Retried"))
        .data
    ).toHaveLength(1);

    const other = await ownerWithWorkshop();
    expect((await create(other.host)).error?.code).toBe("42501");
  });

  test("stale, unversioned, racing and malformed saves are refused without losing the newer agenda", async () => {
    const { host, workshopId } = await ownerWithWorkshop();
    const [loaded] = await versions(host, workshopId);
    // Two tabs save from the same starting point at once: exactly one wins.
    const results = await Promise.all([
      save(host, loaded, agenda()),
      save(host, loaded, { ...agenda(), objectives: [] }),
    ]);
    expect(results.filter(({ error }) => !error)).toHaveLength(1);
    expect(
      results.filter(({ error }) => error?.message === "stale_draft")
    ).toHaveLength(1);
    const winner = results.find(({ error }) => !error)!.data as Version;
    expect((await versions(host, workshopId))[0].content).toEqual(
      winner.content
    );

    // A missing expected revision never skips the check.
    for (const call of [
      host.rpc("save_workshop_draft", {
        p_version: winner.id,
        p_expected_revision: null,
        p_content: agenda(),
      }),
      host.rpc("mark_workshop_ready", {
        p_version: winner.id,
        p_expected_revision: null,
      }),
    ])
      expect((await call).error?.message).toBe("stale_draft");

    const malformed = await save(host, winner, { activities: "not a list" });
    expect(malformed.error?.code).toBe("23514");
    expect(
      (await save(host, winner, withActivity(0, { minutes: 241 }))).error?.code
    ).toBe("23514");
    expect((await versions(host, workshopId))[0].content).toEqual(
      winner.content
    );
  });

  test("Ready to run racing a save: one wins and the other is told the draft moved on", async () => {
    const { host, workshopId } = await ownerWithWorkshop();
    const [draft] = await versions(host, workshopId);
    const complete = (await save(host, draft, agenda())).data as Version;
    const [saved, frozen] = await Promise.all([
      save(host, complete, withActivity(0, { title: "Late edit" })),
      ready(host, complete),
    ]);
    const outcomes = [saved.error?.message, frozen.error?.message];
    expect(outcomes.filter((message) => message === undefined)).toHaveLength(1);
    expect(
      outcomes.filter(
        (message) => message === "stale_draft" || message === "version_ready"
      )
    ).toHaveLength(1);
    const [stored] = await versions(host, workshopId);
    if (frozen.error) {
      expect(stored.state).toBe("draft");
      expect(stored.content.activities[0].title).toBe("Late edit");
    } else {
      expect(stored.state).toBe("ready");
      expect(stored.content).toEqual(agenda());
    }
  });

  test("other hosts, hosts without MFA and anonymous callers cannot read or change workshops", async () => {
    const { host, workshopId, email } = await ownerWithWorkshop();
    const [draft] = await versions(host, workshopId);

    const other = await ownerWithWorkshop();
    expect(await versions(other.host, workshopId)).toEqual([]);
    expect(
      (await other.host.from("workshops").select("id").eq("id", workshopId))
        .data
    ).toEqual([]);
    for (const call of [
      save(other.host, draft, agenda()),
      other.host.rpc("new_workshop_draft", { p_workshop: workshopId }),
      other.host.rpc("duplicate_workshop", {
        p_workshop: workshopId,
        p_operation: randomUUID(),
      }),
      ready(other.host, draft),
    ])
      expect((await call).error?.code).toBe("42501");

    const passwordOnly = client();
    await passwordOnly.auth.signInWithPassword({
      email,
      password: SYNTHETIC_PASSWORD,
    });
    expect(await versions(passwordOnly, workshopId)).toEqual([]);
    expect((await save(passwordOnly, draft, agenda())).error?.code).toBe(
      "42501"
    );

    const withoutWorkspace = await confirmedHost();
    expect(
      (
        await withoutWorkspace.host.rpc("create_workshop", {
          p_title: "Nope",
          p_operation: randomUUID(),
        })
      ).error?.code
    ).toBe("42501");
    const anonymous = client();
    expect(
      (await anonymous.from("workshop_versions").select("id")).error?.code
    ).toBe("42501");
    expect(
      (
        await anonymous.rpc("create_workshop", {
          p_title: "Anon",
          p_operation: randomUUID(),
        })
      ).error?.code
    ).toBe("42501");
  });
});
