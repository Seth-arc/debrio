import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterEach, expect, test } from "vitest";
import { verifyFileAvailability } from "../../lib/file-availability";
import {
  FILE_BUCKET_READY,
  FILE_BUCKET_STAGING,
  scanFileBytes,
  validateFileBytes,
} from "../../lib/resource-file";
import { localSupabaseEnv } from "../../scripts/local-supabase";
import { resourceFixture } from "../support/resources";
import { sql } from "../support/database";

const service = createClient(
  localSupabaseEnv.SUPABASE_URL,
  localSupabaseEnv.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);
Object.assign(process.env, localSupabaseEnv);
const storage = createClient(
  localSupabaseEnv.SUPABASE_STORAGE_URL,
  localSupabaseEnv.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);
const anonStorage = createClient(
  localSupabaseEnv.SUPABASE_STORAGE_URL,
  localSupabaseEnv.SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);
afterEach(() =>
  sql("update public.file_resource_capability set enabled=false;")
);

test("private stored bytes become an immutable released version only after exact validation and scan", async () => {
  const f = await resourceFixture();
  sql("update public.file_resource_capability set enabled=true;");
  const bytes = new TextEncoder().encode("Synthetic private file handout\n");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const resource = randomUUID();
  const begun = await f.host.rpc("begin_file_resource", {
    p_workspace: f.workspace,
    p_operation: randomUUID(),
    p_resource: resource,
    p_revision: 0,
    p_title: "Synthetic protected file",
    p_filename: "synthetic.txt",
    p_mime: "text/plain",
    p_size: bytes.length,
    p_sha256: sha256,
  });
  expect(begun.error).toBeNull();
  const stagedIntent = await service
    .from("resource_file_intents")
    .select("staging_key")
    .eq("id", begun.data.intent)
    .single();
  expect(stagedIntent.error).toBeNull();
  const key = stagedIntent.data!.staging_key as string;
  expect(
    (await anonStorage.storage.from(FILE_BUCKET_STAGING).download(key)).error
  ).not.toBeNull();
  const signed = await storage.storage
    .from(FILE_BUCKET_STAGING)
    .createSignedUploadUrl(key);
  expect(signed.error).toBeNull();
  const form = new FormData();
  form.append("cacheControl", "0");
  form.append("", new File([bytes], "synthetic.txt", { type: "text/plain" }));
  expect(
    (await fetch(signed.data!.signedUrl, { method: "PUT", body: form })).status
  ).toBe(200);
  expect(
    (await anonStorage.storage.from(FILE_BUCKET_STAGING).download(key)).error
  ).not.toBeNull();
  const staged = await storage.storage.from(FILE_BUCKET_STAGING).download(key);
  expect(staged.error).toBeNull();
  const stored = new Uint8Array(await staged.data!.arrayBuffer());
  expect(
    await validateFileBytes(stored, "synthetic.txt", "text/plain")
  ).toMatchObject({ sha256 });
  const scan = await scanFileBytes(stored, "127.0.0.1", 39326);
  expect(scan.scanner).toMatch(/^ClamAV/u);
  expect(
    (
      await service.rpc("validate_file_resource", {
        p_intent: begun.data.intent,
        p_sha256: sha256,
        p_scanner: scan.scanner,
        p_signatures_at: scan.signaturesAt,
      })
    ).error
  ).toBeNull();
  expect(
    (
      await service.rpc("reserve_file_promotion", {
        p_intent: begun.data.intent,
      })
    ).error
  ).toBeNull();
  const intent = await service
    .from("resource_file_intents")
    .select("ready_key")
    .eq("id", begun.data.intent)
    .single();
  expect(intent.error).toBeNull();
  expect(
    (
      await storage.storage
        .from(FILE_BUCKET_READY)
        .upload(intent.data!.ready_key, stored, {
          contentType: "text/plain",
          upsert: false,
        })
    ).error
  ).toBeNull();
  expect(
    (await storage.storage.from(FILE_BUCKET_STAGING).remove([key])).error
  ).toBeNull();
  const finished = await service.rpc("finish_file_resource", {
    p_intent: begun.data.intent,
    p_sha256: sha256,
    p_scanner: scan.scanner,
    p_signatures_at: scan.signaturesAt,
  });
  expect(finished.error).toBeNull();
  const version = finished.data.version as string;
  expect(await verifyFileAvailability(version)).toBe(true);
  expect(
    (
      await service.rpc("finish_file_resource", {
        p_intent: begun.data.intent,
        p_sha256: sha256,
        p_scanner: scan.scanner,
        p_signatures_at: scan.signaturesAt,
      })
    ).data.version
  ).toBe(version);
  expect(
    (
      await anonStorage.storage
        .from(FILE_BUCKET_READY)
        .download(intent.data!.ready_key)
    ).error
  ).not.toBeNull();
  const proposal = f.proposal(version);
  expect((await f.confirm(proposal)).error).toBeNull();
  expect((await f.execute("start")).error).toBeNull();
  const release = { ...proposal, command: "release" as const, revision: 1 };
  expect((await f.confirm(release)).error).toBeNull();
  const allowed = await f.read(0, proposal.allocation);
  expect(allowed.error).toBeNull();
  expect(allowed.data.detail).toMatchObject({
    kind: "file",
    file: { filename: "synthetic.txt", size: bytes.length, status: "ready" },
  });
  expect((await f.read(1, proposal.allocation)).error?.message).toBe(
    "not_allowed"
  );
  expect(
    (
      await storage.storage
        .from(FILE_BUCKET_READY)
        .remove([intent.data!.ready_key])
    ).error
  ).toBeNull();
  expect(await verifyFileAvailability(version)).toBe(false);
  expect((await f.read(0, proposal.allocation)).data.detail.file.status).toBe(
    "unavailable"
  );
  const deleted = await f.host.rpc("delete_file_resource", {
    p_workspace: f.workspace,
    p_intent: begun.data.intent,
  });
  expect(deleted.error).toBeNull();
  expect((await f.read(0, proposal.allocation)).data.detail.file.status).toBe(
    "deleted"
  );
  expect((await f.read(1, proposal.allocation)).error?.message).toBe(
    "not_allowed"
  );
}, 90000);

test("real ClamAV rejects the harmless EICAR signature and outage fails closed", async () => {
  const marker = [
    "X5O!P%@AP[4\\PZX54(P^)7CC)7}$",
    "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
  ].join("");
  await expect(
    scanFileBytes(new TextEncoder().encode(marker), "127.0.0.1", 39326)
  ).rejects.toMatchObject({ code: "malware_detected" });
  await expect(
    scanFileBytes(new TextEncoder().encode("synthetic"), "127.0.0.1", 1)
  ).rejects.toMatchObject({ code: "scan_unavailable" });
}, 30000);

test("actual private bucket accepts exactly 10 MiB and refuses the next byte", async () => {
  const maximum = new Uint8Array(10485760).fill(65);
  const bucket = storage.storage.from(FILE_BUCKET_STAGING);
  const acceptedKey = `${randomUUID()}/${randomUUID()}`;
  const deniedKey = `${randomUUID()}/${randomUUID()}`;
  expect(
    (
      await bucket.upload(acceptedKey, maximum, {
        contentType: "text/plain",
        upsert: false,
      })
    ).error
  ).toBeNull();
  expect(
    (
      await bucket.upload(deniedKey, new Uint8Array(10485761).fill(65), {
        contentType: "text/plain",
        upsert: false,
      })
    ).error
  ).not.toBeNull();
  expect((await bucket.remove([acceptedKey, deniedKey])).error).toBeNull();
}, 60000);
