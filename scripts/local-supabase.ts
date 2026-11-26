// Connection values for the disposable local stack in compose.yaml.
// Run directly to print dotenv lines: node scripts/local-supabase.ts > .env.development.local
import { createHmac } from "node:crypto";
import { pathToFileURL } from "node:url";

// Same local-only secret as compose.yaml; never a hosted value.
export const LOCAL_JWT_SECRET = "local-disposable-only-jwt-signing-secret-0001";
export const LOCAL_SUPABASE_URL = "http://127.0.0.1:39321";
export const LOCAL_MAIL_URL = "http://127.0.0.1:39324";

export function signLocalJwt(claims: object, secret = LOCAL_JWT_SECRET) {
  const part = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = `${part({ alg: "HS256", typ: "JWT" })}.${part(claims)}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

export const LOCAL_ANON_KEY = signLocalJwt({
  role: "anon",
  iss: "debrio-local",
  iat: 1795000000,
});

export const localSupabaseEnv = {
  SUPABASE_URL: LOCAL_SUPABASE_URL,
  SUPABASE_STORAGE_URL: "http://127.0.0.1:39325",
  SUPABASE_ANON_KEY: LOCAL_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: signLocalJwt({
    role: "service_role",
    iss: "debrio-local",
    iat: 1795000000,
  }),
  EXECUTION_DISPATCH_SECRET: "local-synthetic-execution-dispatch-only-0001",
  CLAMAV_HOST: "127.0.0.1",
  CLAMAV_PORT: "39326",
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  for (const [key, value] of Object.entries(localSupabaseEnv))
    console.log(`${key}=${value}`);
}
