import { createServerClient } from "@supabase/ssr";
import {
  isAuthRetryableFetchError,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import { cookies } from "next/headers";

// Server-only values: never NEXT_PUBLIC_, so nothing here reaches the browser bundle.
export function supabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  return url && key ? { url, key } : null;
}

// Only the server reads Auth cookies, so browser scripts never need them.
export const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
} as const;

export async function serverSupabase() {
  const config = supabaseConfig();
  if (!config) return null;
  const store = await cookies();
  return createServerClient(config.url, config.key, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll: () => store.getAll(),
      setAll(toSet) {
        try {
          for (const { name, value, options } of toSet)
            store.set(name, value, options);
        } catch {
          // Server Components cannot write cookies; proxy.ts refreshes them first.
        }
      },
    },
  });
}

export type Host =
  | { state: "unconfigured" | "unavailable" | "signed-out" }
  | {
      state: "aal1" | "aal2";
      supabase: SupabaseClient;
      user: User;
      verifiedFactorIds: string[];
    };

// The Auth server verifies the session on every call; cookies alone are not trusted.
export async function currentHost(): Promise<Host> {
  const supabase = await serverSupabase();
  if (!supabase) return { state: "unconfigured" };
  const { data, error } = await supabase.auth.getUser();
  if (isAuthRetryableFetchError(error)) return { state: "unavailable" };
  if (!data.user) return { state: "signed-out" };
  const { data: level } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const verifiedFactorIds = (data.user.factors ?? [])
    .filter(
      ({ status, factor_type }) =>
        status === "verified" && factor_type === "totp"
    )
    .map(({ id }) => id);
  return {
    state: level?.currentLevel === "aal2" ? "aal2" : "aal1",
    supabase,
    user: data.user,
    verifiedFactorIds,
  };
}

export const SIGN_IN_UNCONFIGURED =
  "Sign-in isn't available in this environment.";

export const SIGN_IN_UNAVAILABLE =
  "Sign-in verification is unavailable right now. Nothing was changed. Try again shortly.";
