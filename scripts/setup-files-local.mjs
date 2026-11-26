// Disposable local keys only; the generated dotenv file is ignored.
import { writeFileSync } from "node:fs";
import { localSupabaseEnv } from "./local-supabase.ts";

writeFileSync(
  ".env.files.local",
  Object.entries(localSupabaseEnv)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n") + "\n",
  "utf8"
);
