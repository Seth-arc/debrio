"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { credentialHash, guestCookieName } from "../../lib/guest";
import {
  executionError,
  executionResourceSummary,
  type Execution,
} from "../../lib/execution";
import { isUuid } from "../../lib/ids";
import { currentHost, guestSupabase } from "../../lib/supabase";
import type { FormState } from "../form";

export async function prepareSession(
  _: FormState,
  data: FormData
): Promise<FormState> {
  const version = String(data.get("version") ?? "");
  const operation = String(data.get("operation") ?? "");
  if (!isUuid(version) || !isUuid(operation))
    return { error: "Reload this form and try again." };
  const host = await currentHost();
  if (host.state !== "aal2") return { error: executionError("not_allowed") };
  const result = await host.supabase.rpc("prepare_execution_v3", {
    p_version: version,
    p_operation: operation,
  });
  if (result.error)
    return {
      error: executionError(result.error.message, result.error.details),
    };
  redirect(`/sessions/${result.data}`);
}

export async function readExecution(
  session: string,
  asHost: boolean,
  resourceDetails = false
): Promise<{ execution?: Execution; error?: string }> {
  if (!isUuid(session)) return { error: executionError("not_allowed") };
  if (asHost) {
    const host = await currentHost();
    if (host.state !== "aal2") return { error: executionError("not_allowed") };
    const { data, error } = await host.supabase.rpc("host_execution_v4", {
      p_session: session,
    });
    return error || !data
      ? { error: executionError(error?.message ?? "unavailable") }
      : {
          execution: resourceDetails
            ? { ...data, resource_details: true }
            : executionResourceSummary(data),
        };
  }
  const credential = (await cookies()).get(guestCookieName(session))?.value;
  const supabase = guestSupabase();
  if (!credential || !supabase) return { error: executionError("not_allowed") };
  const { data, error } = await supabase.rpc("guest_execution", {
    p_session: session,
    p_credential_hash: credentialHash(credential),
  });
  return error || !data
    ? { error: executionError(error?.message ?? "not_allowed") }
    : { execution: data };
}

export async function runExecution(
  session: string,
  operation: string,
  revision: number,
  command: string,
  context: string
): Promise<{ error?: string; uncertain?: boolean }> {
  if (
    !isUuid(session) ||
    !isUuid(operation) ||
    !Number.isInteger(revision) ||
    revision < 1 ||
    !/^[a-f0-9]{64}$/.test(context) ||
    !["start", "pause", "resume", "next", "end"].includes(command)
  )
    return { error: "That command is invalid. Reload the session." };
  const host = await currentHost();
  if (host.state !== "aal2") return { error: executionError("not_allowed") };
  const { data, error } = await host.supabase.rpc("execution_command_v4", {
    p_session: session,
    p_operation: operation,
    p_revision: revision,
    p_command: command,
    p_context: context,
  });
  if (
    !error &&
    !(
      data?.ended === true ||
      (Number.isInteger(data?.revision) &&
        ["ready", "live", "paused", "completed"].includes(data?.state))
    )
  )
    return { error: executionError("unavailable"), uncertain: true };
  // A transport failure may arrive after commit: preserve the operation for retry.
  return error
    ? {
        error: executionError(error.message, error.details),
        uncertain:
          !error.code || !["P0001", "42501", "22023"].includes(error.code),
      }
    : {};
}
