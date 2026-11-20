import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, test } from "vitest";
import { client, confirmedHost, ownerWithMfa } from "../support/hosts";
import { SYNTHETIC_PASSWORD } from "../support/local-auth";

type Version = {
  id: string;
  number: number;
  state: string;
  content: Agenda;
  updated_at: string;
};
type Agenda = { objectives: unknown[]; steps: Record<string, unknown>[] };

// A complete two-stage agenda: the second stage uses the first stage's answer.
const agenda = (): Agenda => ({
  objectives: [{ id: "o1", text: "Give specific feedback" }],
  steps: [
    {
      id: "s1",
      title: "Think alone",
      instructions: "Write what you would say first.",
      scope: "individual",
      minutes: 10,
      outputs: [{ id: "f1", label: "Your opening", kind: "long" }],
      input: null,
      objectives: ["o1"],
    },
    {
      id: "s2",
      title: "Compare in groups",
      instructions: "Agree on the strongest opening.",
      scope: "group",
      minutes: 20,
      outputs: [{ id: "f1", label: "Agreed opening", kind: "short" }],
      input: { step: "s1", field: "f1" },
      objectives: [],
    },
  ],
});

async function ownerWithWorkshop(title = "Feedback practice") {
  const owner = await ownerWithMfa();
  expect(
    (await owner.host.from("workspaces").insert({ name: "Synthetic Practice" }))
      .error
  ).toBeNull();
  const { data, error } = await owner.host.rpc("create_workshop", {
    p_title: title,
  });
  expect(error).toBeNull();
  return { ...owner, workshopId: data.id as string };
}

const versions = async (host: SupabaseClient, workshopId: string) =>
  (
    await host
      .from("workshop_versions")
      .select("id, number, state, content, updated_at")
      .eq("workshop_id", workshopId)
      .order("number")
  ).data as Version[];

const save = (host: SupabaseClient, version: Version, content: unknown) =>
  host.rpc("save_workshop_draft", {
    p_version: version.id,
    p_expected_updated_at: version.updated_at,
    p_content: content,
  });

describe("workshop agendas", { timeout: 60_000 }, () => {
  test("an agenda with objectives, stages and a linked input survives save, reload and reorder", async () => {
    const { host, workshopId } = await ownerWithWorkshop();
    const [draft] = await versions(host, workshopId);
    expect(draft).toMatchObject({ number: 1, state: "draft" });
    expect(draft.content).toEqual({ objectives: [], steps: [] });

    const saved = await save(host, draft, agenda());
    expect(saved.error).toBeNull();
    expect((await versions(host, workshopId))[0].content).toEqual(agenda());

    const reordered = { ...agenda(), steps: [...agenda().steps].reverse() };
    expect((await save(host, saved.data, reordered)).error).toBeNull();
    const stored = (await versions(host, workshopId))[0].content;
    expect(stored.steps.map(({ id }) => id)).toEqual(["s2", "s1"]);
  });

  test("Ready to run refuses an incomplete agenda, then freezes a complete one for good", async () => {
    const { host, workshopId } = await ownerWithWorkshop();
    const [draft] = await versions(host, workshopId);
    const incomplete = agenda();
    incomplete.steps[1].input = { step: "s9", field: "f1" };
    incomplete.steps[0].outputs = [];
    const savedIncomplete = (await save(host, draft, incomplete)).data;
    const refused = await host.rpc("mark_workshop_ready", {
      p_version: savedIncomplete.id,
      p_expected_updated_at: savedIncomplete.updated_at,
    });
    expect(refused.error?.message).toBe("not_ready");
    expect(refused.error?.details).toBe(
      "Stage 1 needs at least one answer field.\nStage 2 uses input from a stage that no longer exists."
    );
    // The editor sees exactly the problems the freeze enforces.
    expect(
      (await host.rpc("workshop_problems", { p_content: incomplete })).data
    ).toEqual(refused.error?.details?.split("\n"));

    const complete = (await save(host, savedIncomplete, agenda())).data;
    const ready = await host.rpc("mark_workshop_ready", {
      p_version: complete.id,
      p_expected_updated_at: complete.updated_at,
    });
    expect(ready.error).toBeNull();
    expect(ready.data.state).toBe("ready");

    // No route can change a ready version.
    expect((await save(host, ready.data, agenda())).error?.message).toBe(
      "version_ready"
    );
    const directUpdate = await host
      .from("workshop_versions")
      .update({ content: { objectives: [], steps: [] } })
      .eq("id", complete.id);
    expect(directUpdate.error?.code).toBe("42501");
    const directDelete = await host
      .from("workshop_versions")
      .delete()
      .eq("id", complete.id);
    expect(directDelete.error?.code).toBe("42501");
    expect((await versions(host, workshopId))[0].content).toEqual(agenda());
  });

  test("editing after Ready to run starts a new draft and leaves the ready version alone", async () => {
    const { host, workshopId } = await ownerWithWorkshop();
    const [draft] = await versions(host, workshopId);
    const complete = (await save(host, draft, agenda())).data;
    await host.rpc("mark_workshop_ready", {
      p_version: complete.id,
      p_expected_updated_at: complete.updated_at,
    });

    const next = await host.rpc("new_workshop_draft", {
      p_workshop: workshopId,
    });
    expect(next.data).toMatchObject({ number: 2, state: "draft" });
    expect(next.data.content).toEqual(agenda());
    const again = await host.rpc("new_workshop_draft", {
      p_workshop: workshopId,
    });
    expect(again.data.id).toBe(next.data.id);

    const changed = agenda();
    changed.steps[0].title = "Think alone, briefly";
    expect((await save(host, next.data, changed)).error).toBeNull();
    const [first, second] = await versions(host, workshopId);
    expect(first).toMatchObject({ number: 1, state: "ready" });
    expect(first.content).toEqual(agenda());
    expect(second.content.steps[0].title).toBe("Think alone, briefly");
  });

  test("duplicating copies the configuration into a new workshop draft", async () => {
    const { host, workshopId } = await ownerWithWorkshop("Coaching basics");
    const [draft] = await versions(host, workshopId);
    await save(host, draft, agenda());
    const copy = await host.rpc("duplicate_workshop", {
      p_workshop: workshopId,
    });
    expect(copy.error).toBeNull();
    expect(copy.data.title).toBe("Copy of Coaching basics");
    const [copied] = await versions(host, copy.data.id);
    expect(copied).toMatchObject({ number: 1, state: "draft" });
    expect(copied.content).toEqual(agenda());
  });

  test("a stale or malformed save is refused without losing the newer agenda", async () => {
    const { host, workshopId } = await ownerWithWorkshop();
    const [loaded] = await versions(host, workshopId);
    // Two tabs save from the same starting point at once: exactly one wins.
    const first = agenda();
    const second = { ...agenda(), objectives: [] };
    const results = await Promise.all([
      save(host, loaded, first),
      save(host, loaded, second),
    ]);
    expect(results.filter(({ error }) => !error)).toHaveLength(1);
    expect(
      results.filter(({ error }) => error?.message === "stale_draft")
    ).toHaveLength(1);
    const winner = results.find(({ error }) => !error)!.data;
    expect((await versions(host, workshopId))[0].content).toEqual(
      winner.content
    );

    const malformed = await save(host, winner, { steps: "not a list" });
    expect(malformed.error?.code).toBe("23514");
    const tooLong = agenda();
    tooLong.steps[0].minutes = 241;
    expect((await save(host, winner, tooLong)).error?.code).toBe("23514");
    expect((await versions(host, workshopId))[0].content).toEqual(
      winner.content
    );
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
      other.host.rpc("duplicate_workshop", { p_workshop: workshopId }),
      other.host.rpc("mark_workshop_ready", {
        p_version: draft.id,
        p_expected_updated_at: draft.updated_at,
      }),
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
        })
      ).error?.code
    ).toBe("42501");
    const anonymous = client();
    expect(
      (await anonymous.from("workshop_versions").select("id")).error?.code
    ).toBe("42501");
    expect(
      (await anonymous.rpc("create_workshop", { p_title: "Anon" })).error?.code
    ).toBe("42501");
  });
});
