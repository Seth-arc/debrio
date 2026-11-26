import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { FILE_BUCKET_READY, fileSha256 } from "./resource-file";

export async function storageObjectMissing(response: Response) {
  if (response.status === 404) return true;
  if (response.status !== 400) return false;
  const body = await response.json().catch(() => null);
  return body?.code === "NoSuchKey" && body?.statusCode === "404";
}

// Call only after an authenticated host RPC has scoped the exact version to
// their session. The service credential never leaves this server module.
export async function verifyFileAvailability(
  version: string
): Promise<boolean> {
  const url = process.env.SUPABASE_URL;
  const storageUrl = process.env.SUPABASE_STORAGE_URL ?? url;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !storageUrl || !key) return false;
  const service = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const found = await service
    .from("resource_file_versions")
    .select("intent_id,storage_key,sha256,byte_size,state")
    .eq("version_id", version)
    .single();
  if (
    found.error ||
    found.data?.state !== "ready" ||
    !/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/u.test(found.data.storage_key)
  )
    return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(
      `${storageUrl}/storage/v1/object/authenticated/${FILE_BUCKET_READY}/${found.data.storage_key}`,
      {
        headers: { authorization: `Bearer ${key}`, apikey: key },
        cache: "no-store",
        signal: controller.signal,
      }
    );
    if (await storageObjectMissing(response)) {
      await service.rpc("set_file_resource_state", {
        p_intent: found.data.intent_id,
        p_state: "unavailable",
        p_error: "missing_object",
      });
      return false;
    }
    if (!response.ok) return false;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (
      bytes.length !== found.data.byte_size ||
      fileSha256(bytes) !== found.data.sha256
    ) {
      await service.rpc("set_file_resource_state", {
        p_intent: found.data.intent_id,
        p_state: "unavailable",
        p_error: "integrity_failure",
      });
      return false;
    }
    const checked = await service.rpc("verify_file_version", {
      p_version: version,
      p_sha256: found.data.sha256,
    });
    return !checked.error && checked.data === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function verifyDueFiles(db: SupabaseClient, session: string) {
  const due = await db.rpc("due_file_versions_for_host", {
    p_session: session,
  });
  if (due.error) return false;
  for (const version of due.data as string[])
    if (!(await verifyFileAvailability(version))) return false;
  return true;
}
