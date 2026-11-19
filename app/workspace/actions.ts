"use server";

import { redirect } from "next/navigation";
import { currentHost, SIGN_IN_UNAVAILABLE } from "../../lib/supabase";
import type { FormState } from "../form";

export async function createWorkspace(
  _: FormState,
  data: FormData
): Promise<FormState> {
  const raw = data.get("name");
  const name = typeof raw === "string" ? raw.trim() : "";
  const values = { name };
  const length = [...name].length;
  if (length < 1 || length > 80)
    return { error: "Enter a workspace name of 1 to 80 characters.", values };
  const host = await currentHost();
  if (host.state === "signed-out") redirect("/sign-in");
  if (host.state === "aal1") redirect("/mfa");
  if (host.state !== "aal2") return { error: SIGN_IN_UNAVAILABLE, values };
  // The database decides ownership and MFA; a repeat create keeps the existing workspace.
  const { error } = await host.supabase.from("workspaces").insert({ name });
  if (error && error.code !== "23505")
    return {
      error:
        "The workspace service is unavailable, so your workspace wasn't created. Try again.",
      values,
    };
  redirect("/workspace");
}
