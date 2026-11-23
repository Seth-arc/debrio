import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { reviewFixture } from "../support/reviews";
import { sql } from "../support/database";
import { agenda } from "../support/execution";
import { createClient } from "@supabase/supabase-js";
import { localSupabaseEnv } from "../../scripts/local-supabase";

test("partial sources need explicit acceptance and never disclose acceptance notes or blank fields", async () => {
  const x = await reviewFixture(true);
  expect((await x.send(x.create())).error?.message).toBe("invalid_review");
  const reopen = {
    ...x.submit(1, 1, "Reopen partial review"),
    command: "reopen",
  };
  expect(
    (await x.workSend(reopen, randomUUID(), x.guest.hash, x.host)).error
  ).toBeNull();
  expect(
    (
      await x.workSend(
        {
          ...reopen,
          command: "accept_partial",
          window_revision: 1,
          reason: "PRIVATE ACCEPTANCE NOTE",
        },
        randomUUID(),
        x.guest.hash,
        x.host
      )
    ).error
  ).toBeNull();
  expect((await x.send(x.create({ fields: ["f2"] }))).error?.message).toBe(
    "invalid_review"
  );
  const id = await x.approved();
  expect(
    (
      await x.send({
        command: "release",
        proposal: id,
        token: (await x.preview(id)).token,
      })
    ).error
  ).toBeNull();
  const view = (await x.resources(1, id)).data;
  expect(view.detail.review.partial).toBe(true);
  expect(JSON.stringify(view)).not.toContain("PRIVATE ACCEPTANCE NOTE");
}, 30000);

test("mixed allocations share the last slot atomically and failed release preserves approval", async () => {
  const x = await reviewFixture();
  const rid = randomUUID();
  expect(
    (
      await x.host.rpc("resource_library_command", {
        p_workspace: x.workspace,
        p_operation: randomUUID(),
        p_request: {
          command: "save",
          resource: rid,
          revision: 0,
          title: "Synthetic existing resource",
          kind: "text",
          content: "Existing brief",
        },
      })
    ).error
  ).toBeNull();
  const frozen = await x.host.rpc("resource_library_command", {
    p_workspace: x.workspace,
    p_operation: randomUUID(),
    p_request: { command: "ready", resource: rid, revision: 1 },
  });
  expect(frozen.error).toBeNull();
  const link = randomUUID();
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
        resource: link,
        revision: 0,
        title: "Synthetic link",
        kind: "link",
        content: "https://example.com/brief",
      })
    ).error
  ).toBeNull();
  const check = await x.host.rpc("begin_resource_check", {
    p_workspace: x.workspace,
    p_resource: link,
    p_revision: 1,
  });
  expect(check.error).toBeNull();
  const service = createClient(
    localSupabaseEnv.SUPABASE_URL,
    localSupabaseEnv.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  expect(
    (
      await service.rpc("finish_resource_check", {
        p_check: check.data.check,
        p_outcome: "reachable",
        p_digest: "a".repeat(64),
        p_final_url: "https://example.com/brief",
        p_actor: x.userId,
      })
    ).error
  ).toBeNull();
  expect(
    (
      await library({
        command: "approve_check",
        check: check.data.check,
        reviewed: true,
      })
    ).error
  ).toBeNull();
  const linkReady = await library({
    command: "ready",
    resource: link,
    revision: 1,
  });
  expect(linkReady.error).toBeNull();
  sql(
    `insert into public.resource_allocations(id,session_id,workspace_id,agenda_version,resource_version,trigger,selectors,created_by) select gen_random_uuid(),'${x.session}','${x.workspace}','${x.version.id}',case when n=99 then '${linkReady.data.version}'::uuid else '${frozen.data.version}'::uuid end,'manual',jsonb_build_array(jsonb_build_object('kind','individual','id','${x.people[1].id}')),(select owner_id from public.workspaces where id='${x.workspace}') from generate_series(1,99) n;`
  );
  const first = await x.approved(),
    second = await x.approved();
  const previews = await Promise.all([x.preview(first), x.preview(second)]);
  const results = await Promise.all([
    x.send({ command: "release", proposal: first, token: previews[0].token }),
    x.send({ command: "release", proposal: second, token: previews[1].token }),
  ]);
  expect(results.filter((r) => !r.error)).toHaveLength(1);
  const failed = results[0].error ? first : second;
  expect(
    (await x.read()).data.items.find((p: { id: string }) => p.id === failed)
      .state
  ).toBe("approved");
  expect((await x.preview(failed)).problems).toContain(
    "This session already has 100 resource allocations."
  );
  expect(
    sql(
      `select count(*) from public.resource_allocations where session_id='${x.session}';`
    )
  ).toBe("100");
  expect((await x.resources()).data.notices).toHaveLength(1);
  expect(
    sql(
      `select count(*) from public.resource_notices where allocation_id='${failed}';`
    )
  ).toBe("0");
}, 60000);

test("existing ten-field agenda ceiling stays intact and proposal history counts toward its cap", async () => {
  const content = agenda();
  content.activities[0].outputs = Array.from({ length: 10 }, (_, i) => ({
    id: `f${i + 1}`,
    label: `Field ${i + 1}`,
    kind: "long",
  }));
  const answers = Object.fromEntries(
    content.activities[0].outputs.map((f) => [f.id, "x".repeat(5000)])
  );
  const x = await reviewFixture(false, content, answers);
  const r = x.create({ fields: Object.keys(answers) });
  expect((await x.send(r)).error).toBeNull();
  const preview = await x.preview(r.proposal);
  expect(preview.source!.fields).toHaveLength(10);
  expect(
    preview.source!.fields.reduce((n, f) => n + Array.from(f.value).length, 0)
  ).toBe(50000);
  expect(
    (
      await x.send(
        x.create({ fields: Array.from({ length: 21 }, (_, i) => `f${i + 1}`) })
      )
    ).error?.message
  ).toBe("invalid_review");
  expect(
    (
      await x.send(
        x.create({ recipients: Array.from({ length: 41 }, () => randomUUID()) })
      )
    ).error?.message
  ).toBe("invalid_review");
  // Populate immutable historical proposals, then test the public last-slot boundary.
  sql(
    `insert into public.review_proposals(id,session_id,workspace_id,version_id,source_attempt,source_owner,source_kind,source_activity,target_activity,fields,recipients,presentation,projection_digest,state,created_by,closed_at) select gen_random_uuid(),session_id,workspace_id,version_id,source_attempt,source_owner,source_kind,source_activity,target_activity,fields,recipients,presentation,projection_digest,'cancelled',created_by,clock_timestamp() from public.review_proposals cross join generate_series(1,98) where id='${r.proposal}';`
  );
  expect((await x.send(x.create())).error).toBeNull();
  expect((await x.send(x.create())).error?.message).toBe("invalid_review");
  expect(
    sql(
      `select count(*) from public.resource_allocations where session_id='${x.session}';`
    )
  ).toBe("0");
}, 30000);

test("proposals and submitted sources paginate independently and reject reused operations", async () => {
  const x = await reviewFixture();
  const operation = randomUUID(),
    r = x.create();
  expect((await x.send(r, undefined, operation)).error).toBeNull();
  expect(
    (await x.send({ ...r, fields: ["f2"] }, undefined, operation)).error
      ?.message
  ).toBe("operation_reused");
  for (let i = 0; i < 20; i++)
    expect((await x.send(x.create())).error).toBeNull();
  const first = await x.read();
  expect(first.data.items).toHaveLength(20);
  expect(first.data.next_offset).toBe(20);
  expect(first.data.sources).toHaveLength(1);
  const second = await x.read(undefined, undefined, 20);
  expect(second.data.items).toHaveLength(1);
  expect(second.data.next_offset).toBeNull();
  expect((await x.read(1)).data.items).toEqual([]);
  const bad = await x.host.rpc("read_reviews", {
    p_session: x.session,
    p_host: true,
    p_source_offset: -1,
  });
  expect(bad.error?.message).toBe("invalid_review");
  expect(
    (
      await x.workSend(
        {
          ...x.submit(1, 1, "Synthetic pagination corrections"),
          command: "reopen",
        },
        randomUUID(),
        x.guest.hash,
        x.host
      )
    ).error
  ).toBeNull();
  for (let ordinal = 2; ordinal <= 21; ordinal++) {
    expect(
      (
        await x.workSend({
          ...x.request,
          revision: ordinal - 1,
          latest: ordinal - 1,
          window_revision: 1,
        })
      ).error
    ).toBeNull();
    expect(
      (
        await x.workSend({
          ...x.submit(ordinal, ordinal - 1, "Synthetic correction"),
          window_revision: 1,
        })
      ).error
    ).toBeNull();
  }
  expect((await x.read()).data.sources).toHaveLength(20);
  const sources = await x.host.rpc("read_reviews", {
    p_session: x.session,
    p_host: true,
    p_source_offset: 20,
  });
  expect(sources.error).toBeNull();
  expect(sources.data.sources).toHaveLength(1);
  expect(sources.data.sources[0].ordinal).toBe(21);
  expect(sources.data.items).toHaveLength(20);
}, 60000);
