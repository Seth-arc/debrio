import { createHash, randomUUID } from "node:crypto";
import { afterEach, expect, test } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { executionHost } from "../support/execution";
import { resourceFixture } from "../support/resources";
import { holdTransaction } from "../support/database";
import { localSupabaseEnv } from "../../scripts/local-supabase";
import { client } from "../support/hosts";
import { sql } from "../support/database";

afterEach(() =>
  sql("update public.file_resource_capability set enabled=false;")
);
const hash = createHash("sha256").update("synthetic file").digest("hex");
const service = createClient(
  localSupabaseEnv.SUPABASE_URL,
  localSupabaseEnv.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  }
);

async function readyFileFixture(payloadHash = hash) {
  const f = await resourceFixture();
  sql("update public.file_resource_capability set enabled=true;");
  const resource = randomUUID();
  const begun = await f.host.rpc("begin_file_resource", {
    p_workspace: f.workspace,
    p_operation: randomUUID(),
    p_resource: resource,
    p_revision: 0,
    p_title: "Synthetic race file",
    p_filename: "race.txt",
    p_mime: "text/plain",
    p_size: 14,
    p_sha256: payloadHash,
  });
  expect(begun.error).toBeNull();
  expect(
    (
      await service.rpc("validate_file_resource", {
        p_intent: begun.data.intent,
        p_sha256: payloadHash,
        p_scanner: "ClamAV synthetic fixture",
        p_signatures_at: new Date().toISOString(),
      })
    ).error
  ).toBeNull();
  expect(
    (
      await service.rpc("reserve_file_promotion", {
        p_intent: begun.data.intent,
      })
    ).error
  ).toBeNull();
  const finished = await service.rpc("finish_file_resource", {
    p_intent: begun.data.intent,
    p_sha256: payloadHash,
    p_scanner: "ClamAV synthetic fixture",
    p_signatures_at: new Date().toISOString(),
  });
  expect(finished.error).toBeNull();
  return {
    f,
    intent: begun.data.intent as string,
    version: finished.data.version as string,
  };
}

test("file upload intent has tenant, MFA, revision and operation boundaries", async () => {
  sql(
    "update public.resource_capability set enabled=true; update public.file_resource_capability set enabled=true;"
  );
  const x = await executionHost();
  const resource = randomUUID();
  const operation = randomUUID();
  const input = {
    p_workspace: x.workspace,
    p_operation: operation,
    p_resource: resource,
    p_revision: 0,
    p_title: "Synthetic PDF handout",
    p_filename: "handout.txt",
    p_mime: "text/plain",
    p_size: 14,
    p_sha256: hash,
  };
  const first = await x.host.rpc("begin_file_resource", input);
  expect(first.error).toBeNull();
  expect(first.data).toMatchObject({
    resource,
    revision: 1,
    state: "pending",
  });
  expect((await x.host.rpc("begin_file_resource", input)).data).toMatchObject(
    first.data
  );
  expect(
    (await x.host.rpc("begin_file_resource", { ...input, p_title: "Changed" }))
      .error?.message
  ).toBe("operation_reused");
  expect(
    (
      await x.host.rpc("begin_file_resource", {
        ...input,
        p_title: "Synthetic",
        p_filename: "PDF|handout.txt",
      })
    ).error?.message
  ).toBe("operation_reused");
  expect(
    (
      await x.host.rpc("begin_file_resource", {
        ...input,
        p_operation: randomUUID(),
      })
    ).error?.message
  ).toBe("resource_conflict");
  expect(
    (
      await client().rpc("read_file_resource", {
        p_workspace: x.workspace,
        p_intent: first.data.intent,
      })
    ).error
  ).not.toBeNull();
  expect(
    (
      await client().rpc("finish_file_resource", {
        p_intent: first.data.intent,
        p_sha256: hash,
        p_scanner: "forged",
        p_signatures_at: new Date().toISOString(),
      })
    ).error
  ).not.toBeNull();
  expect(
    (
      await x.host.rpc("read_file_resource", {
        p_workspace: x.workspace,
        p_intent: first.data.intent,
      })
    ).data
  ).toMatchObject({ state: "pending", resource });
});

test("invalid formats and bounded quota are enforced before any version is ready", async () => {
  sql(
    "update public.resource_capability set enabled=true; update public.file_resource_capability set enabled=true;"
  );
  const x = await executionHost();
  const base = {
    p_workspace: x.workspace,
    p_operation: randomUUID(),
    p_resource: randomUUID(),
    p_revision: 0,
    p_title: "Synthetic file",
    p_filename: "x.txt",
    p_mime: "text/plain",
    p_size: 1,
    p_sha256: hash,
  };
  for (const patch of [
    { p_size: 0 },
    { p_size: 10485761 },
    { p_filename: "x.html" },
    { p_filename: "../x.txt" },
    { p_mime: "text/html" },
    { p_sha256: "bad" },
  ]) {
    const result = await x.host.rpc("begin_file_resource", {
      ...base,
      ...patch,
      p_operation: randomUUID(),
      p_resource: randomUUID(),
    });
    expect(result.error?.message).toBe("invalid_resource");
  }
  const first = await x.host.rpc("begin_file_resource", base);
  expect(first.error).toBeNull();
  expect(
    (
      await x.host.rpc("read_file_resource_for_resource", {
        p_workspace: x.workspace,
        p_resource: base.p_resource,
      })
    ).data.intent
  ).toBe(first.data.intent);
  expect(
    sql(
      `select count(*) from public.resource_versions where resource_id='${base.p_resource}';`
    )
  ).toBe("0");
});

test("file deletion and release serialize in both orders, without a stale grant", async () => {
  for (const first of ["delete", "release"] as const) {
    const { f, intent, version } = await readyFileFixture();
    const proposal = f.proposal(version);
    expect((await f.confirm(proposal)).error).toBeNull();
    expect((await f.execute("start")).error).toBeNull();
    const release = { ...proposal, command: "release" as const, revision: 1 };
    const preview = await f.preview(release);
    const request = { ...release, token: preview.token };
    const unlock = await holdTransaction(
      `select 1 from public.resource_file_versions where version_id='${version}' for update`
    );
    const start = (action: "delete" | "release") =>
      (action === "delete"
        ? f.host.rpc("delete_file_resource", {
            p_workspace: f.workspace,
            p_intent: intent,
          })
        : f.send(request)
      ).then((result) => result);
    const a = start(first);
    let b;
    try {
      await unlock.waitForQueries(
        "query like '%delete_file_resource%' or query like '%resource_command%'",
        1
      );
      b = start(first === "delete" ? "release" : "delete");
      await unlock.waitForQueries(
        "query like '%delete_file_resource%' or query like '%resource_command%'",
        2
      );
    } finally {
      await unlock();
    }
    const [one, two] = await Promise.all([a, b!]);
    expect(one.error).toBeNull();
    if (first === "delete")
      expect(two.error?.message).toBe("resource_unavailable");
    else {
      expect(two.error).toBeNull();
      expect(
        (await f.read(0, proposal.allocation)).data.detail.file.status
      ).toBe("deleted");
    }
  }
}, 90000);

test("stale signatures cannot commit Ready, and expired promotion cannot resume", async () => {
  sql(
    "update public.resource_capability set enabled=true; update public.file_resource_capability set enabled=true;"
  );
  const x = await executionHost();
  const resource = randomUUID();
  const begun = await x.host.rpc("begin_file_resource", {
    p_workspace: x.workspace,
    p_operation: randomUUID(),
    p_resource: resource,
    p_revision: 0,
    p_title: "Synthetic scan freshness",
    p_filename: "scan.txt",
    p_mime: "text/plain",
    p_size: 14,
    p_sha256: hash,
  });
  expect(begun.error).toBeNull();
  const intent = begun.data.intent as string;
  expect(
    (
      await service.rpc("validate_file_resource", {
        p_intent: intent,
        p_sha256: hash,
        p_scanner: "ClamAV synthetic fixture",
        p_signatures_at: new Date().toISOString(),
      })
    ).error
  ).toBeNull();
  expect(
    (await service.rpc("reserve_file_promotion", { p_intent: intent })).error
  ).toBeNull();
  expect(
    (
      await service.rpc("finish_file_resource", {
        p_intent: intent,
        p_sha256: hash,
        p_scanner: "ClamAV synthetic fixture",
        p_signatures_at: new Date(
          Date.now() - 25 * 60 * 60 * 1000
        ).toISOString(),
      })
    ).error?.message
  ).toBe("resource_unavailable");
  expect(
    sql(
      `select count(*) from public.resource_versions where resource_id='${resource}';`
    )
  ).toBe("0");
  sql(
    `update public.resource_file_intents set expires_at=clock_timestamp()-interval '1 second' where id='${intent}';`
  );
  expect(
    (await service.rpc("reserve_file_promotion", { p_intent: intent })).error
      ?.message
  ).toBe("resource_unavailable");
  expect(
    sql(`select state from public.resource_file_intents where id='${intent}';`)
  ).toBe("promoting");
}, 45000);

test("exact committed release receipt survives file deletion, while new release is refused", async () => {
  const { f, intent, version } = await readyFileFixture();
  const proposal = f.proposal(version);
  expect((await f.confirm(proposal)).error).toBeNull();
  expect((await f.execute("start")).error).toBeNull();
  const release = { ...proposal, command: "release" as const, revision: 1 };
  const preview = await f.preview(release);
  const request = { ...release, token: preview.token };
  const operation = randomUUID();
  const committed = await f.send(request, operation);
  expect(committed.error).toBeNull();
  expect(
    (
      await f.send({
        command: "revoke",
        allocation: proposal.allocation,
        participant: null,
        reason: "Synthetic withdrawal",
      })
    ).error
  ).toBeNull();
  expect(
    (
      await f.host.rpc("delete_file_resource", {
        p_workspace: f.workspace,
        p_intent: intent,
      })
    ).error
  ).toBeNull();
  expect(
    (
      await f.host.rpc("file_operation_replay_candidate", {
        p_session: f.session,
        p_operation: operation,
        p_execution: false,
      })
    ).data
  ).toBe(true);
  expect((await f.send(request, operation)).data).toEqual(committed.data);
  expect((await f.preview(f.proposal(version))).problems).toContain(
    "The exact file version is unavailable."
  );
}, 45000);

test("newly known-bad digest atomically disables exact ready versions and future promotion", async () => {
  const digest = createHash("sha256").update(randomUUID()).digest("hex");
  const { f, version } = await readyFileFixture(digest);
  const proposal = f.proposal(version);
  expect((await f.confirm(proposal)).error).toBeNull();
  expect((await f.execute("start")).error).toBeNull();
  const release = { ...proposal, command: "release" as const, revision: 1 };
  expect((await f.confirm(release)).error).toBeNull();
  expect((await f.read(0, proposal.allocation)).data.detail.file.status).toBe(
    "ready"
  );
  expect(
    (await service.rpc("quarantine_file_digest", { p_sha256: digest })).data
  ).toBe(1);
  expect((await f.read(0, proposal.allocation)).data.detail.file.status).toBe(
    "unavailable"
  );
  expect(
    (await service.rpc("quarantine_file_digest", { p_sha256: digest })).data
  ).toBe(0);
  expect(
    (
      await f.host.rpc("begin_file_resource", {
        p_workspace: f.workspace,
        p_operation: randomUUID(),
        p_resource: randomUUID(),
        p_revision: 0,
        p_title: "Rejected known bad digest",
        p_filename: "blocked.txt",
        p_mime: "text/plain",
        p_size: 14,
        p_sha256: digest,
      })
    ).error?.message
  ).toBe("resource_unavailable");
}, 45000);

test("a held upload cannot release quota or survive deletion before its completion receipt", async () => {
  sql(
    "update public.resource_capability set enabled=true; update public.file_resource_capability set enabled=true;"
  );
  const x = await executionHost();
  const begun = await x.host.rpc("begin_file_resource", {
    p_workspace: x.workspace,
    p_operation: randomUUID(),
    p_resource: randomUUID(),
    p_revision: 0,
    p_title: "Synthetic upload race",
    p_filename: "race.txt",
    p_mime: "text/plain",
    p_size: 14,
    p_sha256: hash,
  });
  expect(begun.error).toBeNull();
  const intent = begun.data.intent as string;
  expect(
    (await service.rpc("reserve_file_upload", { p_intent: intent })).data
  ).toBe(true);
  expect(
    (
      await x.host.rpc("delete_file_resource", {
        p_workspace: x.workspace,
        p_intent: intent,
      })
    ).error
  ).toBeNull();
  expect(
    (await service.rpc("purge_file_resource", { p_intent: intent })).error
  ).not.toBeNull();
  expect(
    sql(
      `select purged_at is null from public.resource_file_intents where id='${intent}';`
    )
  ).toBe("t");
  expect(
    (await service.rpc("finish_file_upload", { p_intent: intent })).data
  ).toBe(false);
  expect(
    (await service.rpc("purge_file_resource", { p_intent: intent })).error
  ).toBeNull();
  expect(
    sql(
      `select purged_at is not null from public.resource_file_intents where id='${intent}';`
    )
  ).toBe("t");
}, 45000);

function seedIntents(workspace: string, count: number, byteSize: number) {
  sql(`with owner as (
    select w.id workspace_id,w.owner_id actor_id,s.id auth_session from public.workspaces w
    join lateral (select id from auth.sessions where user_id=w.owner_id order by created_at desc limit 1) s on true
    where w.id='${workspace}'
  ), created as (
    insert into public.resources(id,workspace_id,created_by,revision,title,kind,content)
    select gen_random_uuid(),owner.workspace_id,owner.actor_id,1,'Synthetic quota seed','file',''
    from owner cross join generate_series(1,${count}) returning id,workspace_id,created_by
  )
  insert into public.resource_file_intents(operation_id,workspace_id,resource_id,revision,actor_id,auth_session,auth_expires_at,request_digest,title,filename,mime,byte_size,sha256,staging_key,ready_key)
  select gen_random_uuid(),c.workspace_id,c.id,1,c.created_by,owner.auth_session,
    clock_timestamp()+interval '1 hour',repeat('b',64),'Synthetic quota seed','seed.txt','text/plain',${byteSize},repeat('a',64),
    c.workspace_id::text||'/'||gen_random_uuid()::text,c.workspace_id::text||'/'||gen_random_uuid()::text
  from created c join owner on owner.workspace_id=c.workspace_id;`);
}

test("100-version and 100MiB reservations refuse the exact next intent, including a race", async () => {
  sql(
    "update public.resource_capability set enabled=true; update public.file_resource_capability set enabled=true;"
  );
  const first = await executionHost();
  seedIntents(first.workspace, 99, 1);
  const attempt = (
    x: Awaited<ReturnType<typeof executionHost>>,
    size: number
  ) =>
    x.host.rpc("begin_file_resource", {
      p_workspace: x.workspace,
      p_operation: randomUUID(),
      p_resource: randomUUID(),
      p_revision: 0,
      p_title: "Synthetic boundary",
      p_filename: "boundary.txt",
      p_mime: "text/plain",
      p_size: size,
      p_sha256: hash,
    });
  expect((await attempt(first, 1)).error).toBeNull();
  expect((await attempt(first, 1)).error?.message).toBe(
    "resource_prerequisite"
  );
  const second = await executionHost();
  seedIntents(second.workspace, 99, 1048576);
  const outcomes = await Promise.all([
    attempt(second, 1048576),
    attempt(second, 1048576),
  ]);
  expect(outcomes.filter((result) => !result.error)).toHaveLength(1);
  expect(
    outcomes.filter(
      (result) => result.error?.message === "resource_prerequisite"
    )
  ).toHaveLength(1);
  expect(
    sql(
      `select sum(byte_size) from public.resource_file_intents where workspace_id='${second.workspace}' and purged_at is null;`
    )
  ).toBe("104857600");
}, 90000);
