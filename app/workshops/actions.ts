"use server";

import { redirect } from "next/navigation";
import { isSessionId as isId } from "../../lib/guest";
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

export async function createWorkshop(
  _: FormState,
  data: FormData
): Promise<FormState> {
  const raw = data.get("title");
  const title = typeof raw === "string" ? raw.trim() : "";
  if ([...title].length < 1 || [...title].length > 120)
    return { error: "Enter a workshop title of 1 to 120 characters." };
  const host = await ownerHost();
  if (!host) return { error: SIGN_IN_UNAVAILABLE };
  const { data: workshop, error } = await host.supabase.rpc("create_workshop", {
    p_title: title,
  });
  if (error) return { error: UNAVAILABLE };
  redirect(`/workshops/${workshop.id}`);
}

export type SaveResult =
  { updatedAt: string } | { error: string; problems?: string[] };

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

// Saves the whole agenda; refused if someone saved since `expectedUpdatedAt`.
export async function saveWorkshopDraft(
  versionId: string,
  expectedUpdatedAt: string,
  agenda: unknown
): Promise<SaveResult> {
  if (!isId(versionId) || Number.isNaN(Date.parse(expectedUpdatedAt)))
    return { error: UNAVAILABLE };
  // The database enforces the exact shape; this only bounds the request.
  if (JSON.stringify(agenda ?? null).length > 200_000)
    return { error: "This agenda is too large to save." };
  const host = await ownerHost();
  if (!host) return { error: SIGN_IN_UNAVAILABLE };
  const { data, error } = await host.supabase.rpc("save_workshop_draft", {
    p_version: versionId,
    p_expected_updated_at: expectedUpdatedAt,
    p_content: agenda,
  });
  if (error)
    return error.code === "23514"
      ? {
          error:
            "Some stage settings are outside the allowed limits (for example, more than 240 minutes in one stage). Nothing was saved.",
        }
      : saveError(error.message);
  return { updatedAt: data.updated_at };
}

export async function markWorkshopReady(
  versionId: string,
  expectedUpdatedAt: string
): Promise<SaveResult> {
  if (!isId(versionId) || Number.isNaN(Date.parse(expectedUpdatedAt)))
    return { error: UNAVAILABLE };
  const host = await ownerHost();
  if (!host) return { error: SIGN_IN_UNAVAILABLE };
  const { data, error } = await host.supabase.rpc("mark_workshop_ready", {
    p_version: versionId,
    p_expected_updated_at: expectedUpdatedAt,
  });
  if (error) return saveError(error.message, error.details);
  return { updatedAt: data.updated_at };
}

// Form actions for the read-only view: start a new draft or duplicate.
export async function workshopCommand(data: FormData) {
  const raw = data.get("workshop");
  const workshopId = typeof raw === "string" ? raw : "";
  if (!isId(workshopId)) redirect("/workspace");
  const host = await ownerHost();
  if (!host) redirect(`/workshops/${workshopId}?notice=unavailable`);
  if (data.get("command") === "duplicate") {
    const { data: copy, error } = await host.supabase.rpc(
      "duplicate_workshop",
      { p_workshop: workshopId }
    );
    if (error) redirect(`/workshops/${workshopId}?notice=unavailable`);
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
