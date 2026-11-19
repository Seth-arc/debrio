import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE_OPTIONS, supabaseConfig } from "./lib/supabase";

// Refreshes expiring Auth cookies before signed-in pages render; pages still authorize.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const config = supabaseConfig();
  if (!config) return response;
  const supabase = createServerClient(config.url, config.key, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(toSet, headers) {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet)
          response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers))
          response.headers.set(key, value);
      },
    },
  });
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: [
    "/workspace/:path*",
    "/mfa/:path*",
    "/account/:path*",
    "/sessions/:path*",
  ],
};
