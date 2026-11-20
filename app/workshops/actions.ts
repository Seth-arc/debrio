"use server";

import { redirect } from "next/navigation";
import { isUuid } from "../../lib/ids";
import { currentHost, SIGN_IN_UNAVAILABLE } from "../../lib/supabase";
import type { FormState } from "../form";

// The database decides ownership, MFA, structure and readiness; these only route.
async function ownerHost() {
  const host = await currentHost();
  if (host.state === "signed-out") redirect("/sign-in");
  if (host.state === "aal1") redirect("/mfa");
  return host.state === "aal2" ? host : null;
}

const UNAVAILABLE =
  "The workshop service is unavailable, so nothing was saved. Try again.";

const text = (data: FormData, name: string) => {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
};

export async function createWorkshop(
  _: FormState,
  data: FormData
): Promise<FormState> {
  const title = text(data, "title").trim();
  if ([...title].length < 1 || [...title].length > 120)
    return { error: "Enter a workshop title of 1 to 120 characters." };
  // One operation per rendered form: a resubmitted form returns the same workshop.
  const operation = text(data, "operation");
  if (!isUuid(operation)) return { error: UNAVAILABLE };
  const host = await ownerHost();
  if (!host) return { error: SIGN_IN_UNAVAILABLE };
  const { data: workshop, error } = await host.supabase.rpc("create_workshop", {
    p_title: title,
    p_operation: operation,
  });
  if (error)
    return {
      error:
        error.message === "operation_reused"
          ? "This form had already been used, so no workshop was created. Reload the page, then create the workshop again."
          : UNAVAILABLE,
    };
  redirect(`/workshops/${workshop.id}`);
}

export type SaveResult =
  { revision: number } | { error: string; problems?: string[] };

const SAVE_ERRORS = {
  stale_draft:
    "This draft was changed somewhere else, for example in another tab. Your edits are still on this page; copy anything you need, then reload to see the newer draft.",
  version_ready:
    "This version is already ready to run and can't change. Reload to continue from a new draft.",
  not_ready: "This agenda isn't ready to run yet:",
};

const saveError = (message: string, details?: string): SaveResult => ({
  error:
    Object.entries(SAVE_ERRORS).find(([code]) => code === message)?.[1] ??
    UNAVAILABLE,
  problems:
    message === "not_ready" && details ? details.split("\n") : undefined,
});

const validRevision = (revision: number) =>
  Number.isInteger(revision) && revision > 0;

// Saves the whole agenda; refused if someone saved since `expectedRevision`.
export async function saveWorkshopDraft(
  versionId: string,
  expectedRevision: number,
  agenda: unknown
): Promise<SaveResult> {
  if (!isUuid(versionId) || !validRevision(expectedRevision))
    return { error: UNAVAILABLE };
  // The database enforces the exact shape; this only bounds the request.
  if (JSON.stringify(agenda ?? null).length > 400_000)
    return { error: "This agenda is too large to save." };
  const host = await ownerHost();
  if (!host) return { error: SIGN_IN_UNAVAILABLE };
  const { data, error } = await host.supabase.rpc("save_workshop_draft", {
    p_version: versionId,
    p_expected_revision: expectedRevision,
    p_content: agenda,
  });
  if (error)
    return error.code === "23514"
      ? {
          error:
            "Some settings are outside the allowed limits, so nothing was saved. Check the planned minutes (1 to 240 per activity) and the lengths of the texts.",
        }
      : saveError(error.message);
  return { revision: data.revision };
}

export async function markWorkshopReady(
  versionId: string,
  expectedRevision: number
): Promise<SaveResult> {
  if (!isUuid(versionId) || !validRevision(expectedRevision))
    return { error: UNAVAILABLE };
  const host = await ownerHost();
  if (!host) return { error: SIGN_IN_UNAVAILABLE };
  const { data, error } = await host.supabase.rpc("mark_workshop_ready", {
    p_version: versionId,
    p_expected_revision: expectedRevision,
  });
  if (error) return saveError(error.message, error.details);
  return { revision: data.revision };
}

// Form actions on the workshop page: start a new draft, or duplicate.
export async function workshopCommand(data: FormData) {
  const workshopId = text(data, "workshop");
  if (!isUuid(workshopId)) redirect("/workspace");
  const command = text(data, "command");
  const operation = text(data, "operation");
  if (
    !["new-draft", "duplicate"].includes(command) ||
    (command === "duplicate" && !isUuid(operation))
  )
    redirect(`/workshops/${workshopId}`);
  const host = await ownerHost();
  if (!host) redirect(`/workshops/${workshopId}?notice=unavailable`);
  if (command === "duplicate") {
    const { data: copy, error } = await host.supabase.rpc(
      "duplicate_workshop",
      { p_workshop: workshopId, p_operation: operation }
    );
    if (error)
      redirect(
        `/workshops/${workshopId}?notice=${error.message === "operation_reused" ? "reused" : "unavailable"}`
      );
    redirect(`/workshops/${copy.id}`);
  }
  const { error } = await host.supabase.rpc("new_workshop_draft", {
    p_workshop: workshopId,
  });
  redirect(
    error
      ? `/workshops/${workshopId}?notice=unavailable`
      : `/workshops/${workshopId}`
  );
}
