import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { credentialHash, guestCookieName } from "../../../lib/guest";
import { isUuid } from "../../../lib/ids";
import {
  normalizeResourceUrl,
  validateResourceLink,
} from "../../../lib/resource-link";
import { readResourceRequest } from "../../../lib/resource-request";
import { sessionReply as reply } from "../../../lib/session-request";
import { currentHost, guestSupabase } from "../../../lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failure(error: { message: string; code?: string }, mutation: boolean) {
  const known = [
    "not_allowed",
    "invalid_resource",
    "resource_conflict",
    "stale_resource",
    "resource_unavailable",
    "resource_prerequisite",
    "resource_closed",
    "operation_reused",
    "resource_check_required",
    "resource_check_limited",
  ].includes(error.message);
  const invalid = error.code?.startsWith("22");
  return reply(
    {
      error: known
        ? error.message
        : invalid
          ? "invalid_resource"
          : "unavailable",
      uncertain: mutation && !known && !invalid,
    },
    known ? 200 : invalid ? 400 : 503
  );
}

export async function POST(request: Request) {
  const parsed = await readResourceRequest(request);
  if (parsed.response) return parsed.response;
  const x = parsed.input;
  const r = x.request;
  const mutation = r !== undefined && r.command !== "preview";
  try {
    let db,
      hash: string | null = null;
    if (x.host) {
      const host = await currentHost();
      if (host.state === "unavailable" || host.state === "unconfigured")
        return reply({ error: "unavailable", uncertain: mutation }, 503);
      if (host.state !== "aal2") return reply({ error: "not_allowed" }, 403);
      db = host.supabase;
    } else {
      const credential = (await cookies()).get(
        guestCookieName(x.session!)
      )?.value;
      db = guestSupabase();
      if (!credential || !db) return reply({ error: "not_allowed" }, 403);
      hash = credentialHash(credential);
    }
    if (r?.command === "check") {
      if (
        !x.workspace ||
        Object.keys(r).some(
          (k) => !["command", "resource", "revision", "version"].includes(k)
        ) ||
        !isUuid(r.resource) ||
        !Number.isSafeInteger(r.revision) ||
        (r.revision as number) < 1 ||
        (r.version !== undefined && !isUuid(r.version))
      )
        return reply({ error: "invalid_resource" }, 400);
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY,
        url = process.env.SUPABASE_URL;
      if (!key || !url) return reply({ error: "resource_unavailable" }, 503);
      const begin = await db.rpc("begin_resource_check", {
        p_workspace: x.workspace,
        p_resource: r.resource,
        p_revision: r.revision,
        p_version: r.version ?? null,
      });
      if (begin.error) return failure(begin.error, false);
      if (
        !isUuid(begin.data?.check) ||
        !isUuid(begin.data?.actor) ||
        typeof begin.data?.url !== "string"
      )
        return reply({ error: "unavailable" }, 503);
      let checked;
      try {
        checked = await validateResourceLink(begin.data.url);
      } catch {
        /* Store a failed receipt without exposing destination details. */
      }
      const service = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const finish = await service.rpc("finish_resource_check", {
        p_check: begin.data.check,
        p_outcome: checked ? "reachable" : "failed",
        p_digest: checked?.chainDigest ?? null,
        p_final_url: checked?.finalUrl ?? null,
        p_actor: begin.data.actor,
      });
      if (finish.error) return failure(finish.error, true);
      return reply(
        checked
          ? { receipt: { committed: true } }
          : { error: "resource_check_required" }
      );
    }
    if (r?.command === "save" && r.kind === "link") {
      if (typeof r.content !== "string")
        return reply({ error: "invalid_resource" }, 400);
      try {
        r.content = normalizeResourceUrl(r.content);
      } catch {
        return reply({ error: "invalid_resource" }, 400);
      }
    }
    let result;
    if (x.workspace) {
      if (r?.command === "preview")
        return reply({ error: "invalid_resource" }, 400);
      result =
        r === undefined
          ? await db.rpc("read_resource_library", {
              p_workspace: x.workspace,
              p_resource: x.resource ?? null,
              p_offset: x.offset ?? 0,
              p_metadata_only: x.metadataOnly ?? false,
            })
          : await db.rpc("resource_library_command", {
              p_workspace: x.workspace,
              p_operation: x.operation,
              p_request: r,
            });
    } else if (r?.command === "preview") {
      if (
        Object.keys(r).some(
          (k) => !["command", "proposal", "metadataOnly"].includes(k)
        ) ||
        (r.metadataOnly !== undefined && typeof r.metadataOnly !== "boolean") ||
        !r.proposal ||
        typeof r.proposal !== "object" ||
        Array.isArray(r.proposal)
      )
        return reply({ error: "invalid_resource" }, 400);
      result = await db.rpc("resource_preview", {
        p_session: x.session,
        p_request: r.proposal,
      });
    } else {
      result =
        r === undefined
          ? await db.rpc("read_resources", {
              p_session: x.session,
              p_host: x.host,
              p_credential_hash: hash,
              p_allocation: x.allocation ?? null,
              p_offset: x.offset ?? 0,
            })
          : await db.rpc("resource_command", {
              p_session: x.session,
              p_operation: x.operation,
              p_request: r,
              p_credential_hash: hash,
              p_host: x.host,
            });
    }
    if (result.error) return failure(result.error, mutation);
    return reply(
      r === undefined
        ? x.workspace
          ? { library: result.data }
          : { snapshot: result.data }
        : r.command === "preview"
          ? r.metadataOnly
            ? {
                previewAuthority: {
                  token: result.data?.token,
                  ttl_ms: result.data?.ttl_ms,
                },
              }
            : { preview: result.data }
          : { receipt: result.data }
    );
  } catch {
    return reply({ error: "unavailable", uncertain: mutation }, 503);
  }
}
