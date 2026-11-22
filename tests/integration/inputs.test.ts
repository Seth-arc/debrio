import { randomUUID } from "node:crypto";
import { afterEach, expect, test } from "vitest";
import { inputFixture } from "../support/inputs";
import { sql } from "../support/database";
import { client } from "../support/hosts";

afterEach(() => sql("update public.input_capability set enabled=false;"));

test("latest exact field is consumed atomically; legacy entry refuses and replay cannot duplicate", async () => {
  const x = await inputFixture();
  const before = await x.preview();
  expect(before.inputs.problems).toHaveLength(1);
  expect((await x.execute("next", before)).error?.message).toBe(
    "input_prerequisite"
  );
  const attempt = await x.submit();
  expect((await x.execute("next", before)).error?.message).toBe(
    "stale_execution"
  );
  const state = await x.preview();
  expect(state.inputs.candidates[0].source.attempt).toBe(attempt);
  expect(state.inputs.candidates[0].source.value).toBe(
    "Selected synthetic field"
  );
  expect(JSON.stringify(state.inputs)).not.toContain(
    "Unrelated private answer"
  );
  expect(
    (
      await x.host.rpc("execution_command_v2", {
        p_session: x.session,
        p_operation: randomUUID(),
        p_revision: state.revision,
        p_command: "next",
        p_context: state.coordination
          ? sql(`select public.group_context_token('${x.session}');`)
          : "",
      })
    ).error?.message
  ).toBe("unsupported_agenda");
  const operation = randomUUID();
  const advanced = await x.execute("next", state, operation);
  expect(advanced.error).toBeNull();
  expect((await x.execute("next", state, operation)).data).toEqual(
    advanced.data
  );
  expect(
    sql(
      `select count(*) from public.input_bindings where session_id='${x.session}';`
    )
  ).toBe("1");
  const read = await x.read();
  expect(read.error).toBeNull();
  expect(read.data.items[0].source.attempt).toBe(attempt);
  expect(read.data.ttl_ms).toBeLessThanOrEqual(5000);
  expect(JSON.stringify(read.data)).not.toContain("Unrelated private answer");
}, 60_000);

test("revocation denies legacy writes and replay; gate off preserves reads/revoke; regrant stays fixed", async () => {
  const x = await inputFixture();
  await x.submit();
  expect((await x.execute("next")).error).toBeNull();
  const input = (await x.read()).data.items[0];
  const op = randomUUID();
  const req = x.request({
    activity: "a2",
    content: { f1: "My derived answer" },
  });
  expect((await x.send(req, 0, op)).error).toBeNull();
  sql("update public.input_capability set enabled=false;");
  expect((await x.read()).data.items).toHaveLength(1);
  expect(
    (
      await x.manage({
        command: "revoke",
        binding: input.binding,
        grant: input.grant,
        reason: "Synthetic revoked delivery",
      })
    ).error
  ).toBeNull();
  expect((await x.read()).data.items).toHaveLength(0);
  expect((await x.send(req, 0, op)).error?.message).toBe(
    "input_access_required"
  );
  sql("update public.input_capability set enabled=true;");
  const current = await x.host.rpc("read_inputs", {
    p_session: x.session,
    p_host: true,
  });
  expect(current.error).toBeNull();
  expect(
    (
      await x.manage({
        command: "resolve",
        token: current.data.preview.token,
        reason: "Synthetic fresh confirmation",
      })
    ).error
  ).toBeNull();
  const restored = (await x.read()).data.items[0];
  expect(restored.binding).toBe(input.binding);
  expect(restored.grant).not.toBe(input.grant);
  expect((await x.send(req, 0, op)).error).toBeNull();
  expect(
    sql(
      `select content->>'f1' from public.work_items where session_id='${x.session}' and activity_id='a2';`
    )
  ).toBe("My derived answer");
}, 60_000);

test("a missing new owner blocks the whole transition; source corrections never rebind; target records binding", async () => {
  const x = await inputFixture();
  await x.submit();
  expect(
    (
      await x.send(
        x.request({
          revision: 1,
          latest: 1,
          content: { f1: "Frozen version two", f2: "Complete source" },
        })
      )
    ).error
  ).toBeNull();
  expect(
    (
      await x.send(
        x.request({
          command: "submit",
          revision: 2,
          latest: 1,
          reason: "Correction before consumption",
          content: undefined,
        })
      )
    ).error
  ).toBeNull();
  const first = await x.preview();
  await x.join();
  expect((await x.execute("next", first)).error?.message).toBe(
    "stale_execution"
  );
  expect((await x.execute("next")).error?.message).toBe("input_prerequisite");
  expect(
    sql(
      `select count(*) from public.input_bindings where session_id='${x.session}';`
    )
  ).toBe("0");
  await x.submit(1);
  expect((await x.execute("next")).error).toBeNull();
  for (const flag of [null, true]) {
    expect(
      (
        await client().rpc("read_inputs", {
          p_session: x.session,
          p_credential_hash: x.people[0].hash,
          p_host: flag,
        })
      ).error?.code
    ).toBe("42501");
  }
  const privateRead = (await x.read()).data;
  expect(privateRead.items).toHaveLength(1);
  expect(privateRead.items[0].source.owner).toBe(x.people[0].id);
  const input = (await x.read()).data.items[0];
  expect(input.source.ordinal).toBe(2);
  const reopen = {
    ...x.request({
      command: "reopen",
      reason: "Synthetic correction",
      content: undefined,
    }),
  };
  expect(
    (
      await x.host.rpc("work_command", {
        p_session: x.session,
        p_operation: randomUUID(),
        p_request: reopen,
      })
    ).error
  ).toBeNull();
  expect(
    (
      await x.send(
        x.request({
          revision: 2,
          latest: 2,
          window_revision: 1,
          content: { f1: "Corrected source", f2: "Private unchanged" },
        })
      )
    ).error
  ).toBeNull();
  expect(
    (
      await x.send(
        x.request({
          command: "submit",
          revision: 3,
          latest: 2,
          window_revision: 1,
          reason: "Synthetic correction",
          content: undefined,
        })
      )
    ).error
  ).toBeNull();
  expect((await x.read()).data.items[0].source.value).toBe(
    "Frozen version two"
  );
  expect(
    (
      await x.send(
        x.request({ activity: "a2", content: { f1: "Derived independently" } })
      )
    ).error
  ).toBeNull();
  const target = await x.send(
    x.request({
      activity: "a2",
      command: "submit",
      revision: 1,
      content: undefined,
    })
  );
  expect(target.error).toBeNull();
  expect(
    sql(
      `select input_binding_id from public.work_attempts where id='${target.data.attempt}';`
    )
  ).toBe(input.binding);
  expect((await client().from("input_bindings").select()).error).not.toBeNull();
  expect(
    (
      await client().rpc("consume_inputs", {
        p_session: x.session,
        p_index: 1,
        p_preview: first.inputs,
        p_reason: "forged",
      })
    ).error
  ).not.toBeNull();
}, 60_000);
