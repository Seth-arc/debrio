// Disposable local buckets only. Hosted buckets require separate verification.
import { createClient } from "@supabase/supabase-js";
import { localSupabaseEnv } from "./local-supabase.ts";

const storage = createClient(
  localSupabaseEnv.SUPABASE_STORAGE_URL,
  localSupabaseEnv.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);
for (const name of ["debrio-file-quarantine", "debrio-file-ready"]) {
  const existing = await storage.storage.getBucket(name);
  if (!existing.error) {
    if (existing.data.public) throw Error(`${name} is public`);
    continue;
  }
  const created = await storage.storage.createBucket(name, {
    public: false,
    fileSizeLimit: 10485760,
    allowedMimeTypes: ["application/pdf", "text/plain"],
  });
  if (created.error) throw created.error;
  console.log(`Created private local bucket ${name}`);
}
