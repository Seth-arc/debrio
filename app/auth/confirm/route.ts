import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { serverSupabase } from "../../../lib/supabase";
import { emailChangeStatus } from "../../notices";

// Auth verifies the emailed link, then returns here with a one-time PKCE code.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const flow = params.get("flow");
  // Email change: Auth has already applied each confirmation. Don't exchange the
  // code, which would replace the owner's current session with a weaker one.
  if (flow === "email") redirect(`/account?email=${emailChangeStatus(params)}`);
  const code = params.get("code");
  const supabase = await serverSupabase();
  if (code && supabase) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    // A reset link still needs the authenticator before a new password is set.
    if (!error) redirect(flow === "recovery" ? "/mfa?next=account" : "/mfa");
  }
  redirect("/sign-in?confirm=failed");
}
