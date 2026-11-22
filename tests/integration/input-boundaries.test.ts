import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { afterEach, expect, test } from "vitest";
import { inputFixture } from "../support/inputs";
import { sql } from "../support/database";
import { client } from "../support/hosts";
import { agenda, readyVersion } from "../support/execution";
import { guestJoins, participantId } from "../support/sessions";
import { groupWorkFixture } from "../support/group-work";

afterEach(() =>
  sql(
    "update public.input_capability set enabled=false; update public.group_work_capability set enabled=false;"
  )
);

async function hold(statement: string, seconds = 2.5) {
  const child = spawn(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      "postgres",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { stdio: ["pipe", "pipe", "pipe"] }
  );
  const locked = new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (d) => {
      if (String(d).includes("input-locked")) resolve();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code) reject(new Error(`Lock failed: ${code}`));
    });
  });
  const done = new Promise<number | null>((resolve) =>
    child.on("exit", resolve)
  );
  child.stdin.end(
    `begin; ${statement}; select 'input-locked'; select pg_sleep(${seconds}); commit;`
  );
  await locked;
  return { done };
}

test("definition rejects forward, missing and cross-owner inputs without rewriting frozen agendas", () => {
  const content = agenda();
  content.activities[1].input = { activity: "a1", field: "f1" };
  const problems = (body: typeof content) =>
    JSON.parse(
      sql(
        `select to_json(public.workshop_problems('${JSON.stringify(body)}'::jsonb));`
      )
    );
  expect(problems(content)).toEqual([]);
  content.activities[1].scope = "group";
  expect(problems(content).join(" ")).toContain(
    "same individual or group ownership"
  );
  content.activities[1].scope = "individual";
  content.activities[1].input.field = "f99";
  expect(problems(content).join(" ")).toContain("no longer exists");
  content.activities[1].input = { activity: "a2", field: "f1" };
  expect(problems(content).join(" ")).toContain("earlier activity");
}, 30_000);

test("latest incomplete corrections never fall back; exact partial acceptance and nonblank field are required", async () => {
  const x = await inputFixture();
  await x.submit();
  const before = await x.preview();
  expect(
    (
      await x.send(
        x.request({
          revision: 1,
          latest: 1,
          content: { f1: "Latest partial", f2: "" },
        })
      )
    ).error
  ).toBeNull();
  expect((await x.preview()).context).toBe(before.context);
  const r = x.request({
    command: "submit_incomplete",
    revision: 2,
    latest: 1,
    reason: "Incomplete correction",
    content: undefined,
  });
  expect((await x.send(r)).error).toBeNull();
  expect((await x.execute("next", before)).error?.message).toBe(
    "stale_execution"
  );
  expect((await x.execute("next")).error?.message).toBe("input_prerequisite");
  const acceptance = await x.host.rpc("work_command", {
    p_session: x.session,
    p_operation: randomUUID(),
    p_request: {
      ...r,
      command: "accept_partial",
      latest: 2,
      reason: "Accept this exact partial",
    },
  });
  expect(acceptance.error).toBeNull();
  expect((await x.execute("next")).error).toBeNull();
  expect((await x.read()).data.items[0].source.ordinal).toBe(2);
  expect((await x.read()).data.items[0].source.acceptance.reason).toBe(
    "Accept this exact partial"
  );
}, 60_000);

test("receipt failure rolls back transition, bindings and all grants; concurrent confirmations have one winner", async () => {
  const x = await inputFixture();
  await x.submit();
  const preview = await x.preview();
  sql(
    `create function public.fail_input_receipt() returns trigger language plpgsql as $$ begin if new.session_id='${x.session}' then raise exception 'synthetic_receipt_failure'; end if; return new; end $$; create trigger fail_input_receipt before insert on public.execution_commands for each row execute function public.fail_input_receipt();`
  );
  try {
    expect((await x.execute("next", preview)).error?.message).toBe(
      "synthetic_receipt_failure"
    );
  } finally {
    sql(
      "drop trigger fail_input_receipt on public.execution_commands; drop function public.fail_input_receipt();"
    );
  }
  expect(
    sql(
      `select count(*) from public.input_bindings where session_id='${x.session}';`
    )
  ).toBe("0");
  expect((await x.preview()).revision).toBe(preview.revision);
  const both = await Promise.all([
    x.execute("next", preview),
    x.execute("next", preview),
  ]);
  expect(both.filter((r) => !r.error)).toHaveLength(1);
  expect(both.find((r) => r.error)?.error?.message).toBe("stale_execution");
  expect(
    sql(
      `select count(*) from public.input_grants g join public.input_bindings b on b.id=g.binding_id where b.session_id='${x.session}';`
    )
  ).toBe("1");
}, 60_000);

test("private inputs reject foreign identity/session/host and old credentials; recovery retains exact binding", async () => {
  const x = await inputFixture();
  await x.submit();
  expect((await x.execute("next")).error).toBeNull();
  const original = (await x.read()).data.items;
  const foreign = await inputFixture();
  for (const r of [
    await client().rpc("read_inputs", {
      p_session: x.session,
      p_credential_hash: foreign.people[0].hash,
    }),
    await foreign.host.rpc("read_inputs", {
      p_session: x.session,
      p_host: true,
    }),
    await foreign.host.rpc("input_command", {
      p_session: x.session,
      p_operation: randomUUID(),
      p_request: {
        command: "revoke",
        binding: original[0].binding,
        reason: "forged",
      },
    }),
  ])
    expect(r.error?.code).toBe("42501");
  const key = (
    await x.host
      .from("sessions")
      .select("join_key")
      .eq("id", x.session)
      .single()
  ).data!.join_key;
  const returning = await guestJoins(key, "Synthetic recovered identity", {
    returning: true,
  });
  const id = await participantId(x.host, x.session);
  expect(
    (
      await x.host.rpc("restore_participant", {
        p_request: id,
        p_target: x.people[0].id,
      })
    ).error
  ).toBeNull();
  expect((await x.read()).error?.code).toBe("42501");
  x.people[0].hash = returning.hash;
  expect((await x.read()).data.items).toEqual(original);
}, 60_000);

test("late individual needs first consumption; closure stops grants; deleted source leaves a permanent tombstone", async () => {
  const x = await inputFixture();
  await x.submit();
  expect((await x.execute("next")).error).toBeNull();
  await x.join();
  expect((await x.read(1)).data.items).toEqual([]);
  expect(
    (await x.send(x.request({ activity: "a2", content: { f1: "late" } }, 1), 1))
      .error?.message
  ).toBe("input_access_required");
  const reopen = x.request(
    {
      command: "reopen",
      content: undefined,
      reason: "Late participant completes prerequisite",
    },
    1
  );
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
    (await x.send(x.request({ window_revision: 1 }, 1), 1)).error
  ).toBeNull();
  expect(
    (
      await x.send(
        x.request(
          {
            command: "submit",
            content: undefined,
            revision: 1,
            window_revision: 1,
          },
          1
        ),
        1
      )
    ).error
  ).toBeNull();
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
        reason: "Confirm late owner",
      })
    ).error
  ).toBeNull();
  const input = (await x.read(1)).data.items[0];
  sql(`delete from public.work_attempts where id='${input.source.attempt}';`);
  expect((await x.read(1)).data.items).toEqual([]);
  const unavailable = await x.host.rpc("read_inputs", {
    p_session: x.session,
    p_host: true,
  });
  expect(
    (
      await x.manage({
        command: "resolve",
        token: unavailable.data.preview.token,
        reason: "Cannot restore erased source",
      })
    ).error?.message
  ).toBe("input_prerequisite");
  expect(
    sql(`select id from public.input_bindings where id='${input.binding}';`)
  ).toBe(input.binding);
  expect((await x.execute("end")).error).toBeNull();
  expect(
    (
      await x.manage({
        command: "resolve",
        token: current.data.preview.token,
        reason: "Closed",
      })
    ).error?.message
  ).toBe("input_closed");
  expect((await x.read()).data.items).toHaveLength(1);
  sql(
    `update public.sessions set ended_at=clock_timestamp()-interval '90 days' where id='${x.session}';`
  );
  expect((await x.read()).error?.code).toBe("42501");
}, 60_000);

test("revocation races submission in one serialization; deadline and host expiry are rechecked after waits", async () => {
  const x = await inputFixture();
  await x.submit();
  expect((await x.execute("next")).error).toBeNull();
  const input = (await x.read()).data.items[0];
  expect(
    (
      await x.send(
        x.request({ activity: "a2", content: { f1: "Dependent work" } })
      )
    ).error
  ).toBeNull();
  const lock = await hold(
    `select id from public.sessions where id='${x.session}' for update`
  );
  const [submitted, revoked] = await Promise.all([
    x.send(
      x.request({
        activity: "a2",
        command: "submit",
        revision: 1,
        content: undefined,
      })
    ),
    x.manage({
      command: "revoke",
      binding: input.binding,
      reason: "Race withdrawal",
    }),
  ]);
  expect(await lock.done).toBe(0);
  expect(revoked.error).toBeNull();
  if (submitted.error)
    expect(submitted.error.message).toBe("input_access_required");
  expect(
    sql(
      `select count(*) from public.work_attempts where session_id='${x.session}' and activity_id='a2';`
    )
  ).toBe(submitted.error ? "0" : "1");
  const y = await inputFixture();
  await y.submit();
  const preview = await y.preview();
  sql(
    `alter table public.session_execution disable trigger execution_identity_frozen; update public.session_execution set started_at=statement_timestamp()-interval '4 hours'+interval '1 second',deadline=statement_timestamp()+interval '1 second' where session_id='${y.session}'; alter table public.session_execution enable trigger execution_identity_frozen;`
  );
  const delayed = await hold(
    `select id from public.sessions where id='${y.session}' for update`
  );
  const result = await y.execute("next", preview);
  expect(await delayed.done).toBe(0);
  expect(result.data?.ended).toBe(true);
  expect(
    sql(
      `select count(*) from public.input_bindings where session_id='${y.session}';`
    )
  ).toBe("0");
  const z = await inputFixture();
  await z.submit();
  const p = await z.preview();
  const token = (await z.host.auth.getSession()).data.session!.access_token;
  const authSession = JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString()
  ).session_id;
  sql(
    `update auth.sessions set not_after=clock_timestamp()+interval '1 second' where id='${authSession}';`
  );
  const wait = await hold(
    `select id from public.sessions where id='${z.session}' for update`
  );
  expect((await z.execute("next", p)).error?.code).toBe("42501");
  expect(await wait.done).toBe(0);
}, 60_000);

test("actual database/API restart restores fixed bindings and revocation without replay", async () => {
  const x = await inputFixture();
  await x.submit();
  expect((await x.execute("next")).error).toBeNull();
  const before = (await x.read()).data.items;
  await x.manage({
    command: "revoke",
    binding: before[0].binding,
    reason: "Durable revocation before crash",
  });
  const start = sql("select pg_postmaster_start_time();");
  const count = sql(
    `select count(*) from public.input_commands where session_id='${x.session}';`
  );
  for (const args of [
    ["compose", "kill", "-s", "SIGKILL", "db", "rest"],
    ["compose", "up", "-d", "--wait", "db", "rest"],
  ]) {
    const r = spawnSync("docker", args, { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
  }
  await expect
    .poll(async () => (await x.read()).error, { timeout: 20000 })
    .toBeNull();
  expect((await x.read()).data.items).toEqual([]);
  expect(sql("select pg_postmaster_start_time();")).not.toBe(start);
  expect(
    sql(
      `select count(*) from public.input_commands where session_id='${x.session}';`
    )
  ).toBe(count);
  expect(
    sql(
      `select attempt_id from public.input_bindings where id='${before[0].binding}';`
    )
  ).toBe(before[0].source.attempt);
}, 90_000);

test("valid chains prepare without evidence; duplicates carry only configuration and legacy protocols refuse even v3 replay", async () => {
  const x = await inputFixture();
  const content = agenda();
  content.activities[1].input = { activity: "a1", field: "f1" };
  content.activities.push({
    ...content.activities[1],
    id: "a3",
    input: { activity: "a2", field: "f1" },
  });
  const v = await readyVersion(x.host, content);
  const op = randomUUID();
  const prepared = await x.host.rpc("prepare_execution_v3", {
    p_version: v.id,
    p_operation: op,
  });
  expect(prepared.error).toBeNull();
  for (const fn of ["prepare_execution", "prepare_execution_v2"])
    expect(
      (await x.host.rpc(fn, { p_version: v.id, p_operation: op })).error
        ?.message
    ).toBe("unsupported_agenda");
  const copied = await x.host.rpc("duplicate_workshop", {
    p_workshop: v.workshop,
    p_operation: randomUUID(),
  });
  expect(copied.error).toBeNull();
  const duplicate = await x.host
    .from("workshop_versions")
    .select("id,content")
    .eq("workshop_id", copied.data.id)
    .single();
  expect(duplicate.error).toBeNull();
  expect(duplicate.data!.content).toEqual(content);
  expect(
    sql(
      `select count(*) from public.input_bindings where version_id in ('${v.id}','${duplicate.data!.id}');`
    )
  ).toBe("0");
  const invalid = structuredClone(content);
  invalid.activities[1].scope = "group";
  expect(
    (
      await x.host.rpc("save_workshop_draft", {
        p_version: v.id,
        p_expected_revision: 2,
        p_content: invalid,
      })
    ).error
  ).not.toBeNull();
  expect(
    (
      await x.host
        .from("workshop_versions")
        .select("content")
        .eq("id", v.id)
        .single()
    ).data!.content
  ).toEqual(content);
}, 60_000);

test("accepted partial does not make a blank selected field eligible", async () => {
  const x = await inputFixture();
  expect(
    (
      await x.send(
        x.request({ content: { f1: " \t", f2: "Only other field supplied" } })
      )
    ).error
  ).toBeNull();
  const req = x.request({
    command: "submit_incomplete",
    content: undefined,
    revision: 1,
    reason: "Other field only",
  });
  expect((await x.send(req)).error).toBeNull();
  expect(
    (
      await x.host.rpc("work_command", {
        p_session: x.session,
        p_operation: randomUUID(),
        p_request: {
          ...req,
          command: "accept_partial",
          latest: 1,
          reason: "Accept partial work, not a missing linked answer",
        },
      })
    ).error
  ).toBeNull();
  expect((await x.execute("next")).error?.message).toBe("input_prerequisite");
}, 60_000);

test("source submission versus consumption preserves one exact source order", async () => {
  const x = await inputFixture();
  const first = await x.submit();
  expect(
    (
      await x.send(
        x.request({
          revision: 1,
          latest: 1,
          content: { f1: "Competing correction", f2: "Complete" },
        })
      )
    ).error
  ).toBeNull();
  const preview = await x.preview();
  const lock = await hold(
    `select id from public.sessions where id='${x.session}' for update`
  );
  const [submitted, advanced] = await Promise.all([
    x.send(
      x.request({
        command: "submit",
        revision: 2,
        latest: 1,
        content: undefined,
        reason: "Competing correction",
      })
    ),
    x.execute("next", preview),
  ]);
  expect(await lock.done).toBe(0);
  if (advanced.error) {
    expect(advanced.error.message).toBe("stale_execution");
    expect(submitted.error).toBeNull();
    expect(
      sql(
        `select count(*) from public.input_bindings where session_id='${x.session}';`
      )
    ).toBe("0");
  } else {
    expect(submitted.error?.message).toBe("work_closed");
    expect((await x.read()).data.items[0].source.attempt).toBe(first);
  }
}, 60_000);

test("capability disable drains consumption; replay never resurrects a revoked grant", async () => {
  const x = await inputFixture();
  await x.submit();
  const preview = await x.preview();
  const lock = await hold(
    "lock table public.execution_commands in share mode",
    4
  );
  const advance = x.execute("next", preview);
  const running = Promise.resolve(advance);
  await expect
    .poll(
      () =>
        sql(
          "select exists(select 1 from pg_locks where relation='public.execution_commands'::regclass and not granted);"
        ),
      { timeout: 3000 }
    )
    .toBe("t");
  const off = spawn(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      "postgres",
      "-At",
      "-c",
      "update public.input_capability set enabled=false;",
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  const stopped = new Promise<number | null>((resolve) =>
    off.on("exit", resolve)
  );
  expect(await lock.done).toBe(0);
  expect((await running).error).toBeNull();
  expect(await stopped).toBe(0);
  const input = (await x.read()).data.items[0];
  expect(input.source.ordinal).toBe(1);
  expect(
    (await x.send(x.request({ activity: "a2", content: { f1: "disabled" } })))
      .error?.message
  ).toBe("input_access_required");
  expect(
    (
      await x.manage({
        command: "revoke",
        binding: input.binding,
        reason: "Revoke while gated off",
      })
    ).error
  ).toBeNull();
  sql("update public.input_capability set enabled=true;");
  const current = await x.host.rpc("read_inputs", {
    p_session: x.session,
    p_host: true,
  });
  const op = randomUUID();
  const request = {
    command: "resolve",
    token: current.data.preview.token,
    reason: "Fresh grant",
  };
  expect((await x.manage(request, op)).error).toBeNull();
  expect(
    (await x.manage({ ...request, reason: "Changed payload" }, op)).error
      ?.message
  ).toBe("operation_reused");
  expect(
    (
      await x.manage({
        command: "revoke",
        binding: input.binding,
        reason: "Revoked again",
      })
    ).error
  ).toBeNull();
  expect((await x.manage(request, op)).data).toEqual({ committed: true });
  expect((await x.read()).data.items).toHaveLength(0);
}, 60_000);

test("receipt insert/replay and preview reads recheck host expiry after their last blocking lock", async () => {
  for (const mode of ["insert", "replay", "preview"] as const) {
    const x = await inputFixture();
    await x.submit();
    expect((await x.execute("next")).error).toBeNull();
    const binding = (await x.read()).data.items[0].binding;
    const request = { command: "revoke", binding, reason: "Expiry boundary" };
    const op = randomUUID();
    if (mode === "replay")
      expect((await x.manage(request, op)).error).toBeNull();
    const token = (await x.host.auth.getSession()).data.session!.access_token;
    const authSession = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString()
    ).session_id;
    sql(
      `update auth.sessions set not_after=statement_timestamp()+interval '2 seconds' where id='${authSession}';`
    );
    const locked = await hold(
      mode === "insert"
        ? "lock table public.input_commands in share mode"
        : mode === "replay"
          ? "lock table public.input_commands in access exclusive mode"
          : "lock table public.input_capability in access exclusive mode",
      3
    );
    const result =
      mode === "preview"
        ? await x.host.rpc("read_inputs", {
            p_session: x.session,
            p_host: true,
          })
        : await x.manage(request, op);
    expect(await locked.done).toBe(0);
    expect(result.error?.code).toBe("42501");
    expect((await x.read()).data.items).toHaveLength(mode === "replay" ? 0 : 1);
  }
}, 90_000);

test("a source lock cannot extend the original ninety-day retained-read boundary", async () => {
  const x = await inputFixture();
  await x.submit();
  expect((await x.execute("next")).error).toBeNull();
  expect((await x.execute("end")).error).toBeNull();
  sql(
    `update public.sessions set ended_at=statement_timestamp()-interval '90 days'+interval '2 seconds' where id='${x.session}';`
  );
  expect((await x.read()).data.ttl_ms).toBeLessThan(2000);
  const lock = await hold(
    "lock table public.work_attempts in access exclusive mode",
    2.5
  );
  expect((await x.read()).error?.code).toBe("42501");
  expect(await lock.done).toBe(0);
}, 60_000);

test("partial acceptance and activity end serialize with consume and late inclusion", async () => {
  const x = await inputFixture();
  expect(
    (
      await x.send(
        x.request({
          content: { f1: "Eligible field, missing other answer", f2: "" },
        })
      )
    ).error
  ).toBeNull();
  const req = x.request({
    command: "submit_incomplete",
    content: undefined,
    revision: 1,
    reason: "Partial source",
  });
  expect((await x.send(req)).error).toBeNull();
  const preview = await x.preview();
  const lock = await hold(
    `select id from public.sessions where id='${x.session}' for update`
  );
  const [accepted, advanced] = await Promise.all([
    x.host.rpc("work_command", {
      p_session: x.session,
      p_operation: randomUUID(),
      p_request: {
        ...req,
        command: "accept_partial",
        latest: 1,
        reason: "Accept exact partial",
      },
    }),
    x.execute("next", preview),
  ]);
  expect(await lock.done).toBe(0);
  expect(accepted.error).toBeNull();
  expect(["input_prerequisite", "stale_execution"]).toContain(
    advanced.error?.message
  );
  expect(
    sql(
      `select count(*) from public.input_bindings where session_id='${x.session}';`
    )
  ).toBe("0");
  expect((await x.execute("next")).error).toBeNull();
  const input = (await x.read()).data.items[0];
  expect(
    (
      await x.manage({
        command: "revoke",
        binding: input.binding,
        reason: "Prepare fresh inclusion",
      })
    ).error
  ).toBeNull();
  const current = await x.host.rpc("read_inputs", {
    p_session: x.session,
    p_host: true,
  });
  const ending = await x.preview();
  const close = await hold(
    `select id from public.sessions where id='${x.session}' for update`
  );
  const [included, ended] = await Promise.all([
    x.manage({
      command: "resolve",
      token: current.data.preview.token,
      reason: "Explicit inclusion",
    }),
    x.execute("end", ending),
  ]);
  expect(await close.done).toBe(0);
  expect(ended.error).toBeNull();
  if (included.error) expect(included.error.message).toBe("input_closed");
  expect((await x.read()).data.items).toHaveLength(included.error ? 0 : 1);
}, 60_000);

test("recorder replacement and membership removal racing consume never mix source or recipients", async () => {
  for (const change of ["recorder", "membership"] as const) {
    const x = await groupWorkFixture(true, false, true);
    await x.save();
    const source = await x.send(await x.request("submit"));
    expect(source.error).toBeNull();
    const before = await x.host.rpc("host_execution_v3", {
      p_session: x.sessionId,
    });
    expect(before.error).toBeNull();
    const lock = await hold(
      `select id from public.sessions where id='${x.sessionId}' for update`
    );
    const [changed, advanced] = await Promise.all([
      change === "recorder" ? x.recorder(1) : x.move(2, null),
      x.execute("next", before.data.context),
    ]);
    expect(await lock.done).toBe(0);
    if (advanced.error) {
      expect(advanced.error.message).toBe("stale_execution");
      expect(changed.error).toBeNull();
      expect(
        sql(
          `select count(*) from public.input_bindings where session_id='${x.sessionId}';`
        )
      ).toBe("0");
    } else {
      expect(
        sql(
          `select attempt_id from public.input_bindings where session_id='${x.sessionId}';`
        )
      ).toBe(source.data.attempt);
      const read = await client().rpc("read_inputs", {
        p_session: x.sessionId,
        p_credential_hash: x.people[2].hash,
      });
      expect(read.error).toBeNull();
      if (changed.error)
        expect(["group_work_conflict", "group_conflict"]).toContain(
          changed.error.message
        );
      expect(read.data.items).toHaveLength(
        change === "membership" && !changed.error ? 0 : 1
      );
    }
  }
}, 90_000);
