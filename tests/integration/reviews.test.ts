import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { reviewFixture } from "../support/reviews";
import { client } from "../support/hosts";
import { command } from "../support/execution";
import { decide } from "../support/sessions";
import { sql } from "../support/database";

describe("fixed submitted review permissions", { timeout: 30000 }, () => {
  it("requires exact author approval and releases only selected fields once", async () => {
    const x = await reviewFixture();
    const request = x.create();
    expect((await x.send(request)).error).toBeNull();
    expect((await x.read(0)).data.items).toEqual([]);
    expect((await x.read(1)).data.items).toEqual([]);
    expect(
      (await x.send({ command: "request", proposal: request.proposal })).error
    ).toBeNull();
    expect(
      (await x.send({ command: "approve", proposal: request.proposal }, 1))
        .error?.message
    ).toBe("not_allowed");
    expect(
      (await x.send({ command: "approve", proposal: request.proposal })).error
        ?.message
    ).toBe("not_allowed");
    expect((await x.preview(request.proposal)).problems.length).toBeGreaterThan(
      0
    );
    expect(
      (await x.send({ command: "approve", proposal: request.proposal }, 0))
        .error
    ).toBeNull();
    const preview = await x.preview(request.proposal);
    expect(preview.problems).toEqual([]);
    const operation = randomUUID();
    const release = {
      command: "release",
      proposal: request.proposal,
      token: preview.token,
    };
    expect((await x.send(release, undefined, operation)).error).toBeNull();
    expect((await x.send(release, undefined, operation)).error).toBeNull();
    const view = await x.resources(1, request.proposal);
    expect(view.error).toBeNull();
    expect(view.data.detail.kind).toBe("review");
    expect(view.data.detail.review.fields).toEqual([
      {
        field: { id: "f1", kind: "long", label: "Expected answer 1" },
        value: "Synthetic explanation",
        authors: [x.person],
      },
    ]);
    expect(JSON.stringify(view.data)).not.toContain('"f2"');
    expect(view.data.notices).toHaveLength(1);
    expect((await x.resources(2)).data.items).toEqual([]);
    expect((await x.resources(2, request.proposal)).error?.message).toBe(
      "not_allowed"
    );
    expect(
      (
        await client().rpc("read_work", {
          p_session: x.session,
          p_credential_hash: x.people[1].hash,
          p_host: false,
        })
      ).data.items.every(
        (i: { participant: string }) => i.participant === x.people[1].id
      )
    ).toBe(true);
    expect(
      (await client().from("review_proposals").select("*")).error
    ).not.toBeNull();
    expect(
      (
        await client().rpc("review_source", {
          p_attempt: x.attempt,
          p_fields: ["f1"],
        })
      ).error
    ).not.toBeNull();
  });

  it("invalidates a preview after reviewer credential and admission changes", async () => {
    const x = await reviewFixture(),
      id = await x.approved();
    const before = await x.preview(id);
    const credential = randomBytes(32).toString("hex");
    const hostToken = (await x.host.auth.getSession()).data.session!
      .access_token;
    const claims = Buffer.from(hostToken.split(".")[1], "base64url")
      .toString()
      .replaceAll("'", "''");
    sql(
      `begin; select set_config('request.jwt.claims','${claims}',true); update public.session_participants set credential_hash='${credential}' where id='${x.people[1].id}'; commit;`
    );
    const recovered = await x.preview(id);
    expect(recovered.token).not.toBe(before.token);
    expect(JSON.stringify(recovered)).not.toContain(credential);
    sql(
      `begin; select set_config('request.jwt.claims','${claims}',true); update public.session_participants set decided_at=decided_at+interval '1 second' where id='${x.people[1].id}'; commit;`
    );
    const readmitted = await x.preview(id);
    expect(readmitted.token).not.toBe(recovered.token);
    expect(
      (await x.send({ command: "release", proposal: id, token: before.token }))
        .error?.message
    ).toBe("stale_review");
    expect(
      (
        await x.send({
          command: "release",
          proposal: id,
          token: readmitted.token,
        })
      ).error
    ).toBeNull();
  });

  it("withdraws across old release retries, notices and generic resource mutations", async () => {
    const x = await reviewFixture(),
      id = await x.approved();
    const release = {
      command: "release",
      proposal: id,
      token: (await x.preview(id)).token,
    };
    const op = randomUUID();
    expect((await x.send(release, undefined, op)).error).toBeNull();
    expect(
      (
        await x.host.rpc("resource_command", {
          p_session: x.session,
          p_operation: randomUUID(),
          p_request: {
            command: "revoke",
            allocation: id,
            participant: null,
            reason: "Bypass",
          },
        })
      ).error?.message
    ).toBe("not_allowed");
    expect(
      (await x.send({ command: "withdraw", proposal: id }, 0)).error
    ).toBeNull();
    expect((await x.send(release, undefined, op)).error).toBeNull();
    expect((await x.resources()).data.items).toEqual([]);
    expect((await x.resources()).data.notices).toEqual([]);
    expect((await x.resources(1, id)).error?.message).toBe("not_allowed");
    expect(
      (await x.send({ command: "approve", proposal: id }, 0)).error?.message
    ).toBe("review_closed");
    expect((await x.workRead()).data.items[0].attempts[0].id).toBe(x.attempt);
  });

  it("closes on legacy end and never reopens from a correction window", async () => {
    const x = await reviewFixture(),
      id = await x.approved();
    expect(
      (
        await x.send({
          command: "release",
          proposal: id,
          token: (await x.preview(id)).token,
        })
      ).error
    ).toBeNull();
    expect((await command(x.host, x.session, 3, "end")).error).toBeNull();
    expect((await x.resources()).data.items).toEqual([]);
    expect((await x.read()).data.items[0].state).toBe("closed");
    expect(
      (
        await x.send({
          command: "release",
          proposal: id,
          token: (await x.preview(id)).token,
        })
      ).error?.message
    ).toBe("review_closed");
  });

  it("refuses malformed selection, self-review and unknown sources without disclosure", async () => {
    const x = await reviewFixture();
    for (const patch of [
      { fields: ["f1", "f1"] },
      { fields: [] },
      { fields: ["missing"] },
      { recipients: [x.person] },
      { recipients: [x.people[1].id, x.people[1].id] },
      { attempt: randomUUID() },
      { activity: "a1" },
    ])
      expect((await x.send(x.create(patch))).error?.message).toBe(
        "invalid_review"
      );
    expect((await x.resources()).data.items).toEqual([]);
  });

  it("invalidates removed author or recipient permanently despite re-admission", async () => {
    const x = await reviewFixture(),
      id = await x.approved();
    expect(
      (
        await x.send({
          command: "release",
          proposal: id,
          token: (await x.preview(id)).token,
        })
      ).error
    ).toBeNull();
    expect((await decide(x.host, x.people[1].id, "remove")).error).toBeNull();
    // Admission currently refuses restoring removed identities. Exercise a future
    // explicit re-admission with the existing host checks still enforced.
    const token = (await x.host.auth.getSession()).data.session!.access_token;
    const claims = Buffer.from(token.split(".")[1], "base64url")
      .toString()
      .replaceAll("'", "''");
    sql(
      `begin; select set_config('request.jwt.claims','${claims}',true); update public.session_participants set state='admitted' where id='${x.people[1].id}'; commit;`
    );
    expect((await x.resources()).data.items).toEqual([]);
    expect((await decide(x.host, x.person, "remove")).error).toBeNull();
    sql(
      `begin; select set_config('request.jwt.claims','${claims}',true); update public.session_participants set state='admitted' where id='${x.person}'; commit;`
    );
    expect((await x.read()).data.items[0].state).toBe("closed");
  }, 30_000);

  it("keeps decline terminal and permits a separately approved proposal", async () => {
    const x = await reviewFixture(),
      r = x.create();
    expect((await x.send(r)).error).toBeNull();
    expect(
      (await x.send({ command: "request", proposal: r.proposal })).error
    ).toBeNull();
    expect(
      (await x.send({ command: "decline", proposal: r.proposal }, 0)).error
    ).toBeNull();
    expect(
      (await x.send({ command: "approve", proposal: r.proposal }, 0)).error
        ?.message
    ).toBe("review_closed");
    const next = await x.approved();
    expect((await x.preview(next)).problems).toEqual([]);
  });
});
