// Operator incident action: disable every Ready version with a known-bad SHA-256.
// Supply service credentials through the environment; never print them.
import { createClient } from "@supabase/supabase-js";

const digest = process.argv[2];
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!/^[0-9a-f]{64}$/u.test(digest ?? "") || !url || !key) {
  process.stderr.write(
    "Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/quarantine-file-digest.mjs <sha256>\n"
  );
  process.exit(2);
}
const service = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const result = await service.rpc("quarantine_file_digest", {
  p_sha256: digest,
});
if (result.error) {
  process.stderr.write(
    "Unable to quarantine digest; access remains unverified.\n"
  );
  process.exit(1);
}
process.stdout.write(`Quarantined ${result.data} ready version(s).\n`);
