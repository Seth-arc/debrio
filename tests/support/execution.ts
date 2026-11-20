import { sql } from "./database";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expect } from "vitest";
import type { Agenda } from "../../lib/agenda";
import { hostWithSession } from "./sessions";

export function agenda(): Agenda {
  return {
    objectives: [],
    activities: [1, 2].map((n) => ({
      id: `a${n}`,
      title: `Task ${n}`,
      instructions: `Private task ${n} instructions.`,
      scope: "individual",
      minutes: 10,
      outputs: [{ id: "f1", label: `Expected answer ${n}`, kind: "long" }],
      input: null,
      objectives: [],
    })),
  };
}

export async function readyVersion(host: SupabaseClient, content = agenda()) {
  const made = await host.rpc("create_workshop", {
    p_title: "Synthetic execution",
    p_operation: randomUUID(),
  });
  expect(made.error).toBeNull();
  const { data: version } = await host
    .from("workshop_versions")
    .select("id,revision")
    .eq("workshop_id", made.data.id)
    .single();
  const saved = await host.rpc("save_workshop_draft", {
    p_version: version!.id,
    p_expected_revision: version!.revision,
    p_content: content,
  });
  expect(saved.error).toBeNull();
  const frozen = await host.rpc("mark_workshop_ready", {
    p_version: version!.id,
    p_expected_revision: saved.data.revision,
  });
  expect(frozen.error).toBeNull();
  return { id: version!.id as string, workshop: made.data.id as string };
}

export async function executionHost() {
  const owner = await hostWithSession();
  const version = await readyVersion(owner.host);
  const result = await owner.host.rpc("prepare_execution", {
    p_version: version.id,
    p_operation: randomUUID(),
  });
  expect(result.error).toBeNull();
  const sessionId = result.data as string;
  const { data: session } = await owner.host
    .from("sessions")
    .select("join_key,workspace_id")
    .eq("id", sessionId)
    .single();
  sql(
    `insert into public.execution_eligibility values ('${session!.workspace_id}',clock_timestamp()+interval '1 hour') on conflict(workspace_id) do update set valid_until=excluded.valid_until;`
  );
  return {
    ...owner,
    version,
    sessionId,
    key: session!.join_key as string,
    workspace: session!.workspace_id as string,
  };
}

export const command = (
  host: SupabaseClient,
  session: string,
  revision: number,
  action: string,
  operation = randomUUID()
) =>
  host.rpc("execution_command", {
    p_session: session,
    p_operation: operation,
    p_revision: revision,
    p_command: action,
  });
export const snapshot = async (host: SupabaseClient, session: string) => {
  const result = await host.rpc("host_execution", { p_session: session });
  expect(result.error).toBeNull();
  return result.data;
};
