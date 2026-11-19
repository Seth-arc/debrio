import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, test } from "vitest";
import { signLocalJwt } from "../../scripts/local-supabase";
import { client, confirmedHost, ownerWithMfa } from "../support/hosts";

const workspaces = (host: SupabaseClient) => host.from("workspaces");

describe("personal workspace authorization", { timeout: 30_000 }, () => {
  test("an MFA owner creates exactly one workspace that only they can read", async () => {
    const owner = await ownerWithMfa();
    const created = await workspaces(owner.host)
      .insert({ name: "Synthetic Consulting" })
      .select()
      .single();
    expect(created.error).toBeNull();
    expect(created.data).toMatchObject({
      name: "Synthetic Consulting",
      owner_id: owner.userId,
    });

    const duplicate = await workspaces(owner.host).insert({ name: "Second" });
    expect(duplicate.error?.code).toBe("23505");
    expect((await workspaces(owner.host).select("id")).data).toHaveLength(1);

    const other = await ownerWithMfa();
    expect(
      (await workspaces(other.host).select().eq("id", created.data.id)).data
    ).toEqual([]);
    const rename = await workspaces(other.host)
      .update({ name: "Taken" })
      .eq("id", created.data.id);
    expect(rename.error?.code).toBe("42501");
    const remove = await workspaces(other.host)
      .delete()
      .eq("id", created.data.id);
    expect(remove.error?.code).toBe("42501");
    // The owner cannot change ownership either: there is no update path.
    const handOver = await workspaces(owner.host)
      .update({ owner_id: other.userId })
      .eq("id", created.data.id);
    expect(handOver.error?.code).toBe("42501");
  });

  test("sessions without MFA, anonymous callers and forged owners are denied", async () => {
    const withoutMfa = await confirmedHost();
    const aal1 = await workspaces(withoutMfa.host).insert({ name: "No MFA" });
    expect(aal1.error?.code).toBe("42501");
    expect((await workspaces(withoutMfa.host).select()).data).toEqual([]);

    const anonymous = await workspaces(client()).insert({ name: "Nobody" });
    expect(anonymous.error?.code).toBe("42501");

    const owner = await ownerWithMfa();
    const forged = await workspaces(owner.host).insert({
      name: "Forged",
      owner_id: withoutMfa.userId,
    });
    expect(forged.error?.code).toBe("42501");
    expect((await workspaces(owner.host).select()).data).toEqual([]);
  });

  test("a wrong-signature token and a signed-out session's token are denied", async () => {
    const owner = await ownerWithMfa();
    expect(
      (await workspaces(owner.host).insert({ name: "Before sign-out" })).error
    ).toBeNull();
    const { data } = await owner.host.auth.getSession();
    const token = data.session!.access_token;
    const claims = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString()
    );

    const forgedToken = signLocalJwt(claims, "not-the-local-signing-secret");
    const forged = await workspaces(client(forgedToken)).select();
    expect(forged.error?.code).toBe("PGRST301");

    expect((await workspaces(client(token)).select()).data).toHaveLength(1);
    expect(
      (await owner.host.auth.signOut({ scope: "local" })).error
    ).toBeNull();
    // The access token has not expired, but its Auth session no longer exists.
    expect(claims.exp * 1000).toBeGreaterThan(Date.now());
    expect((await workspaces(client(token)).select()).data).toEqual([]);
  });

  test("workspace names must contain 1 to 80 visible characters", async () => {
    const owner = await ownerWithMfa();
    const blankOrPadded = ["   ", "\t\n", " Leading", "Trailing\t"];
    for (const name of [...blankOrPadded, "x".repeat(81)]) {
      const invalid = await workspaces(owner.host).insert({ name });
      expect(invalid.error?.code).toBe("23514");
    }
    expect((await workspaces(owner.host).select()).data).toEqual([]);
  });
});
