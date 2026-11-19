import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { serverSupabase } from "../../../lib/supabase";

// Auth verifies the emailed link, then returns here with a one-time PKCE code.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const supabase = await serverSupabase();
  if (code && supabase) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) redirect("/mfa");
  }
  redirect("/sign-in?confirm=failed");
}
