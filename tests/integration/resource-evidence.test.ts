import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, expect, test } from "vitest";
import { inputFixture } from "../support/inputs";
import { groupWorkFixture } from "../support/group-work";
import { client } from "../support/hosts";
import { sql } from "../support/database";
import type { ResourceProposal } from "../../lib/resources";

afterEach(() =>
  sql(
    "update public.resource_capability set enabled=false; update public.input_capability set enabled=false; update public.group_work_capability set enabled=false;"
  )
);

function evidenceHashes() {
  // Whole-table hashes catch accidental changes outside the selected session too.
  const tables = [
    "work_items",
    "work_attempts",
    "work_partial_acceptances",
    "work_commands",
    "group_recorders",
    "group_recorder_changes",
    "group_recorder_commands",
    "group_membership_intervals",
    "group_draft_grants",
    "group_contribution_versions",
    "group_answer_versions",
    "input_bindings",
    "input_grants",
    "input_commands",
  ];
  return sql(
    tables
      .map(
        (table) =>
          `select '${table}',md5(coalesce(string_agg(row_data,E'\\n' order by row_data),'')) from (select row_to_json(t)::text row_data from public.${table} t) s;`
      )
      .join("\n")
  );
}

async function grant(
  host: SupabaseClient,
  session: string,
  participant: string
) {
  sql("update public.resource_capability set enabled=true;");
  const workspace = (
    await host
      .from("sessions")
      .select("workspace_id")
      .eq("id", session)
      .single()
  ).data!.workspace_id as string;
  const resource = randomUUID();
  const library = (request: object) =>
    host.rpc("resource_library_command", {
      p_workspace: workspace,
      p_operation: randomUUID(),
      p_request: request,
    });
  expect(
    (
      await library({
        command: "save",
        resource,
        revision: 0,
        title: "Independent host brief",
        kind: "text",
        content: "Host-authored directions only",
      })
    ).error
  ).toBeNull();
  const ready = await library({ command: "ready", resource, revision: 1 });
  expect(ready.error).toBeNull();
  const proposal: ResourceProposal = {
    command: "release",
    allocation: randomUUID(),
    revision: 0,
    version: ready.data.version,
    trigger: "manual",
    activity: null,
    selectors: [{ kind: "individual", id: participant }],
    restore: [],
    reason: "Synthetic instruction release",
  };
  // Release a newly scheduled allocation; each step is separately previewed.
  const send = async (p: ResourceProposal) => {
    const preview = await host.rpc("resource_preview", {
      p_session: session,
      p_request: p,
    });
    expect(preview.error).toBeNull();
    expect(preview.data.problems).toEqual([]);
    const result = await host.rpc("resource_command", {
      p_session: session,
      p_operation: randomUUID(),
      p_request: { ...p, token: preview.data.token },
      p_host: true,
    });
    expect(result.error).toBeNull();
  };
  await send({ ...proposal, command: "schedule" });
  await send({ ...proposal, revision: 1 });
  return { workspace, library, proposal: { ...proposal, revision: 2 } };
}

test("AC9: individual resource authority cannot reveal another answer, private field or fixed-input source and cannot change Evidence", async () => {
  const x = await inputFixture();
  await x.join();
  const first = await x.submit(0);
  await x.submit(1);
  expect((await x.execute("next")).error).toBeNull();
  const ownBefore = (await x.read(0)).data.items;
  const readOther = () =>
    client().rpc("read_work", {
      p_session: x.session,
      p_credential_hash: x.people[0].hash,
    });
  const workBefore = (await readOther()).data;
  const hashes = evidenceHashes();
  const resource = await grant(x.host, x.session, x.people[0].id);
  expect(evidenceHashes()).toBe(hashes);
  expect((await x.read(0)).data.items).toEqual(ownBefore);
  expect((await readOther()).data).toEqual(workBefore);
  const readResources = (person: number, allocation: string | null = null) =>
    client().rpc("read_resources", {
      p_session: x.session,
      p_credential_hash: x.people.at(person)!.hash,
      p_allocation: allocation,
    });
  const allowed = await readResources(0, resource.proposal.allocation);
  expect(allowed.error).toBeNull();
  expect(allowed.data.detail.content).toBe("Host-authored directions only");
  expect(JSON.stringify(allowed.data)).not.toContain(
    "Unrelated private answer"
  );
  expect(JSON.stringify(allowed.data)).not.toContain(first);
  expect((await readResources(1)).data.items).toEqual([]);
  expect(
    (await readResources(1, resource.proposal.allocation)).error?.message
  ).toBe("not_allowed");
  expect((await readResources(0, first)).error?.message).toBe("not_allowed");
  const forged = await x.host.rpc("resource_preview", {
    p_session: x.session,
    p_request: {
      ...resource.proposal,
      allocation: randomUUID(),
      revision: 0,
      command: "schedule",
      version: first,
    },
  });
  expect(forged.error !== null || forged.data?.problems?.length > 0).toBe(true);
  expect(
    (
      await resource.library({
        command: "save",
        resource: randomUUID(),
        revision: 0,
        title: "Forbidden import",
        kind: "text",
        content: "Text",
        source: first,
      })
    ).error?.message
  ).toBe("invalid_resource");
  expect(evidenceHashes()).toBe(hashes);
}, 60000);

test("AC6: fixed-input consumption and an activity resource release roll back and retry as one transition", async () => {
  const x = await inputFixture();
  await x.submit();
  sql("update public.resource_capability set enabled=true;");
  const id = randomUUID();
  const library = (request: object) =>
    x.host.rpc("resource_library_command", {
      p_workspace: x.workspace,
      p_operation: randomUUID(),
      p_request: request,
    });
  expect(
    (
      await library({
        command: "save",
        resource: id,
        revision: 0,
        title: "Activity two brief",
        kind: "text",
        content: "Read your fixed input, then answer independently.",
      })
    ).error
  ).toBeNull();
  const ready = await library({ command: "ready", resource: id, revision: 1 });
  expect(ready.error).toBeNull();
  const proposal: ResourceProposal = {
    command: "schedule",
    allocation: randomUUID(),
    revision: 0,
    version: ready.data.version,
    trigger: "activity",
    activity: "a2",
    selectors: [{ kind: "individual", id: x.people[0].id }],
    restore: [],
    reason: "Synthetic activity brief",
  };
  const p = await x.host.rpc("resource_preview", {
    p_session: x.session,
    p_request: proposal,
  });
  expect(p.error).toBeNull();
  expect(
    (
      await x.host.rpc("resource_command", {
        p_session: x.session,
        p_operation: randomUUID(),
        p_request: { ...proposal, token: p.data.token },
        p_host: true,
      })
    ).error
  ).toBeNull();
  const preview = await x.host.rpc("host_execution_v4", {
    p_session: x.session,
  });
  expect(preview.error).toBeNull();
  expect(preview.data.inputs.candidates).toHaveLength(1);
  expect(preview.data.resources.items).toHaveLength(1);
  const operation = randomUUID();
  const advance = () =>
    x.host.rpc("execution_command_v4", {
      p_session: x.session,
      p_operation: operation,
      p_revision: preview.data.revision,
      p_context: preview.data.context,
      p_command: "next",
    });
  sql(
    `create function public.test_combined_resource_receipt() returns trigger language plpgsql as $$ begin if new.session_id='${x.session}'::uuid then raise exception 'synthetic_combined_failure'; end if; return new; end $$; create trigger test_combined_resource_receipt before insert on public.execution_commands for each row execute function public.test_combined_resource_receipt();`
  );
  try {
    expect((await advance()).error?.message).toBe("synthetic_combined_failure");
    expect(
      sql(
        `select count(*) from public.input_bindings where session_id='${x.session}';`
      )
    ).toBe("0");
    expect(
      sql(
        `select count(*) from public.resource_notices where allocation_id='${proposal.allocation}';`
      )
    ).toBe("0");
    expect(
      sql(
        `select current_index from public.session_execution where session_id='${x.session}';`
      )
    ).toBe("0");
  } finally {
    sql(
      "drop trigger test_combined_resource_receipt on public.execution_commands; drop function public.test_combined_resource_receipt();"
    );
  }
  expect((await advance()).error).toBeNull();
  expect((await advance()).error).toBeNull();
  expect((await x.read()).data.items[0].source.value).toBe(
    "Selected synthetic field"
  );
  expect(
    sql(
      `select count(*) from public.input_bindings where session_id='${x.session}';`
    )
  ).toBe("1");
  expect(
    sql(
      `select count(*) from public.resource_notices where allocation_id='${proposal.allocation}';`
    )
  ).toBe("1");
  const resource = await client().rpc("read_resources", {
    p_session: x.session,
    p_credential_hash: x.people[0].hash,
    p_allocation: proposal.allocation,
  });
  expect(resource.error).toBeNull();
  expect(resource.data.detail.content).toBe(
    "Read your fixed input, then answer independently."
  );
}, 60000);

test("AC9: a non-contributor's resource grant cannot expand field-only group input, history, recorder or private acceptance access", async () => {
  const x = await groupWorkFixture(true, false, true);
  expect((await x.move(2, x.groups[1])).error).toBeNull();
  expect(
    (
      await x.send(
        await x.request("answer", {
          revision: 0,
          content: { f1: "Selected immutable group field", f2: "" },
          sources: {},
        })
      )
    ).error
  ).toBeNull();
  const submitted = await x.send(
    await x.request("submit_incomplete", {
      reason: "Private submission reason",
    })
  );
  expect(submitted.error).toBeNull();
  expect(
    (
      await x.send(
        await x.request("accept_partial", {
          reason: "Private host acceptance reason",
        }),
        null
      )
    ).error
  ).toBeNull();
  expect((await x.move(2, x.groups[0])).error).toBeNull();
  expect((await x.execute("next")).error).toBeNull();
  const readInput = () =>
    client().rpc("read_inputs", {
      p_session: x.sessionId,
      p_credential_hash: x.people[2].hash,
    });
  const beforeInput = (await readInput()).data.items;
  const beforeWork = await x.read(2);
  const hashes = evidenceHashes();
  const resource = await grant(x.host, x.sessionId, x.people[2].id);
  expect(evidenceHashes()).toBe(hashes);
  expect((await readInput()).data.items).toEqual(beforeInput);
  expect(await x.read(2)).toEqual(beforeWork);
  expect(JSON.stringify(beforeInput)).not.toContain(
    "Private host acceptance reason"
  );
  expect(JSON.stringify(beforeInput)).not.toContain(
    "Private submission reason"
  );
  const readResource = () =>
    client().rpc("read_resources", {
      p_session: x.sessionId,
      p_credential_hash: x.people[2].hash,
      p_allocation: resource.proposal.allocation,
    });
  expect((await readResource()).data.detail.content).toBe(
    "Host-authored directions only"
  );
  expect(JSON.stringify((await readResource()).data)).not.toContain(
    submitted.data.attempt
  );
  expect((await x.move(2, x.groups[1])).error).toBeNull();
  expect((await readResource()).data.detail.content).toBe(
    "Host-authored directions only"
  );
  expect((await readInput()).data.items).toEqual([]);
  expect(JSON.stringify(await x.read(2))).not.toContain(
    "Selected immutable group field"
  );
}, 60000);
