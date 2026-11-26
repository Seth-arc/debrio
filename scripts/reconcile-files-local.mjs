// Local disposable-stack reconciliation. Hosted scheduling is disabled until
// storage, scanner and backup feasibility are verified.
import { createClient } from "@supabase/supabase-js";
import { localSupabaseEnv } from "./local-supabase.ts";

const service = createClient(
  localSupabaseEnv.SUPABASE_URL,
  localSupabaseEnv.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);
const storage = createClient(
  localSupabaseEnv.SUPABASE_STORAGE_URL,
  localSupabaseEnv.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const { data, error } = await service
  .from("resource_file_intents")
  .select("id,state,expires_at,staging_key,ready_key,cleanup_next_at")
  .is("purged_at", null)
  .in("state", [
    "deleted",
    "pending",
    "uploading",
    "promoting",
    "unavailable",
    "rejected",
  ])
  .or(`state.eq.deleted,expires_at.lt.${new Date().toISOString()}`)
  .order("created_at", { ascending: true })
  .limit(1000);
if (error) throw Error("cleanup_query_failed");
let purged = 0;
let pending = 0;
for (const item of data ?? []) {
  if (
    item.cleanup_next_at &&
    new Date(item.cleanup_next_at).valueOf() > Date.now()
  )
    continue;
  if (item.state !== "deleted") {
    if (new Date(item.expires_at).valueOf() > Date.now()) continue;
    const result = await service.rpc("expire_file_resource", {
      p_intent: item.id,
    });
    if (result.error) {
      pending++;
      continue;
    }
    if (!result.data) continue;
  }
  const staged = await storage.storage
    .from("debrio-file-quarantine")
    .remove([item.staging_key]);
  const ready = await storage.storage
    .from("debrio-file-ready")
    .remove([item.ready_key]);
  if (staged.error || ready.error) {
    await service.rpc("record_file_cleanup_failure", {
      p_intent: item.id,
      p_error: "storage_unavailable",
    });
    pending++;
    continue;
  }
  const result = await service.rpc("purge_file_resource", {
    p_intent: item.id,
  });
  if (result.error) {
    await service.rpc("record_file_cleanup_failure", {
      p_intent: item.id,
      p_error: "purge_unavailable",
    });
    pending++;
  } else purged++;
}
console.log(JSON.stringify({ purged, pending }));
if (pending) process.exitCode = 1;
