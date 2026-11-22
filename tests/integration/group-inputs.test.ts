import { randomUUID } from "node:crypto";
import { afterEach, expect, test } from "vitest";
import { groupWorkFixture } from "../support/group-work";
import { sql } from "../support/database";
import { client } from "../support/hosts";

afterEach(() =>
  sql(
    "update public.input_capability set enabled=false; update public.group_work_capability set enabled=false;"
  )
);

test("same-group grants reveal only a selected field to a new non-contributor; intervals never revive", async () => {
  const x = await groupWorkFixture(true, false, true);
  expect((await x.move(2, x.groups[1])).error).toBeNull();
  await x.save("Exact original group field");
  const submitted = await x.send(await x.request("submit"));
  expect(submitted.error).toBeNull();
  expect((await x.move(2, x.groups[0])).error).toBeNull();
  expect((await x.execute("next")).error).toBeNull();
  const read = () =>
    client().rpc("read_inputs", {
      p_session: x.sessionId,
      p_credential_hash: x.people[2].hash,
    });
  const input = await read();
  expect(input.error).toBeNull();
  expect(input.data.items[0].source.value).toBe("Exact original group field");
  expect(Object.keys(input.data.items[0].source).sort()).toEqual(
    [
      "acceptance",
      "attempt",
      "authors",
      "field",
      "kind",
      "ordinal",
      "owner",
      "source_activity",
      "source_title",
      "submitter",
      "value",
    ].sort()
  );
  expect(JSON.stringify(input.data)).not.toContain('"f2"');
  const source = (await x.read(2)).items.find((i) => i.activity.id === "a1");
  expect(source?.attempts ?? []).toHaveLength(0);
  expect((await x.move(2, null)).error).toBeNull();
  expect((await read()).data.items).toHaveLength(0);
  expect((await x.move(2, x.groups[0])).error).toBeNull();
  expect((await read()).data.items).toHaveLength(0);
  const contribution = await x.request(
    "contribute",
    { activity: "a2", revision: 0, field: "f1", value: "Own local idea" },
    2
  );
  expect((await x.send(contribution, 2)).error?.message).toBe(
    "input_access_required"
  );
  const preview = await x.host.rpc("read_inputs", {
    p_session: x.sessionId,
    p_host: true,
  });
  expect(preview.error).toBeNull();
  const managed = await x.host.rpc("input_command", {
    p_session: x.sessionId,
    p_operation: randomUUID(),
    p_request: {
      command: "resolve",
      token: preview.data.preview.token,
      reason: "Confirm new membership interval",
    },
  });
  expect(managed.error).toBeNull();
  expect((await read()).data.items[0].binding).toBe(
    input.data.items[0].binding
  );
  expect((await read()).data.items[0].interval).not.toBe(
    input.data.items[0].interval
  );
  expect((await x.send(contribution, 2)).error).toBeNull();
  expect((await x.recorder(2)).error).toBeNull();
  const fresh = (await read()).data.items[0];
  expect(
    (
      await x.host.rpc("input_command", {
        p_session: x.sessionId,
        p_operation: randomUUID(),
        p_request: {
          command: "revoke",
          binding: fresh.binding,
          grant: fresh.grant,
          reason: "Withdraw this field grant",
        },
      })
    ).error
  ).toBeNull();
  const revoked = await x.request(
    "answer",
    {
      activity: "a2",
      revision: 0,
      content: { f1: "Recorder answer" },
      sources: {},
    },
    2
  );
  expect((await x.send(revoked, 2)).error?.message).toBe(
    "input_access_required"
  );
  expect(
    (
      await x.send(
        await x.request(
          "contribute",
          {
            activity: "a2",
            revision: 0,
            field: "f1",
            value: "Other member continues",
          },
          1
        ),
        1
      )
    ).error
  ).toBeNull();
}, 60_000);

test("a newly populated group needs its own submitted source and explicit first consumption", async () => {
  const x = await groupWorkFixture(true, false, true);
  await x.save("First group's source");
  expect((await x.send(await x.request("submit"))).error).toBeNull();
  expect((await x.move(2, x.groups[1])).error).toBeNull();
  expect((await x.recorder(2, x.groups[1])).error).toBeNull();
  const read = () =>
    client().rpc("read_inputs", {
      p_session: x.sessionId,
      p_credential_hash: x.people[2].hash,
    });
  const resolve = async () => {
    const preview = await x.host.rpc("read_inputs", {
      p_session: x.sessionId,
      p_host: true,
    });
    expect(preview.error).toBeNull();
    return x.host.rpc("input_command", {
      p_session: x.sessionId,
      p_operation: randomUUID(),
      p_request: {
        command: "resolve",
        token: preview.data.preview.token,
        reason: "Confirm newly populated group's own field",
      },
    });
  };
  expect(
    (
      await x.send(
        await x.request(
          "answer",
          {
            revision: 0,
            content: { f1: "New group's exact field", f2: "Private detail" },
            sources: {},
          },
          2,
          x.groups[1]
        ),
        2
      )
    ).error
  ).toBeNull();
  expect(
    (await x.send(await x.request("submit", {}, 2, x.groups[1]), 2)).error
  ).toBeNull();
  expect((await x.move(2, x.groups[0])).error).toBeNull();
  expect((await x.execute("next")).error).toBeNull();
  expect((await x.move(2, x.groups[2])).error).toBeNull();
  expect((await x.recorder(2, x.groups[2])).error).toBeNull();
  expect((await read()).data.items).toEqual([]);
  expect((await resolve()).error?.message).toBe("input_prerequisite");
  expect((await x.move(2, x.groups[1])).error).toBeNull();
  expect((await x.recorder(2, x.groups[1])).error).toBeNull();
  expect((await read()).data.items).toEqual([]);
  expect((await resolve()).error).toBeNull();
  const inputs = (await read()).data.items;
  expect(inputs).toHaveLength(1);
  expect(inputs[0].source).toMatchObject({
    owner: x.groups[1],
    value: "New group's exact field",
  });
  expect(JSON.stringify(inputs)).not.toContain("Private detail");
}, 60_000);
