import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// D2's scheduler calls this bounded operation; access expiry never waits for it.
export async function POST(request: Request) {
  const secret = process.env.EXECUTION_DISPATCH_SECRET;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.SUPABASE_URL;
  const provided = request.headers.get("authorization") ?? "";
  if (!secret || secret.length < 32 || !key || !url)
    return Response.json({ error: "unavailable" }, { status: 503 });
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(provided);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return Response.json({ error: "not_allowed" }, { status: 401 });
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.rpc("expire_executions");
  return error
    ? Response.json({ error: "unavailable" }, { status: 503 })
    : Response.json({ expired: data });
}
