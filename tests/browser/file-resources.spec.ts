import { expect, test } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { prepareWork } from "../support/work-browser";
import { expectAccessible, ownerWithWorkspace } from "../support/browser";
import { sql } from "../support/database";

test("synthetic protected file upload, scoped release, checked download and revocation", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  sql(
    "update public.resource_capability set enabled=true; update public.file_resource_capability set enabled=true;"
  );
  const x = await prepareWork(page, browser, { resources: true });
  const title = "Synthetic protected handout";
  const content = "Synthetic private handout for one admitted participant.\n";
  await page.goto("/resources");
  await page.getByRole("button", { name: "New protected file" }).click();
  const editor = page
    .getByRole("heading", { name: "New file resource" })
    .locator("..");
  await editor.getByLabel("Resource title").fill(title);
  await editor.getByLabel("Choose file").setInputFiles({
    name: "synthetic.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(content),
  });
  await editor.getByRole("button", { name: "Upload and validate" }).click();
  await expect(
    page
      .getByRole("heading", { name: "File resource", exact: true })
      .locator("..")
      .getByRole("status")
  ).toHaveText("Ready to mark", { timeout: 40_000 });
  await page.reload();
  await page.getByRole("button", { name: title }).click();
  await expect(
    page
      .getByRole("heading", { name: "File resource", exact: true })
      .locator("..")
      .getByRole("status")
  ).toHaveText("Ready to mark");
  await page.getByRole("button", { name: "Mark ready" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Ready" })
  ).toBeVisible();
  await expectAccessible(page);
  const readyEditor = page
    .getByRole("heading", { name: "File resource", exact: true })
    .locator("..");
  await readyEditor.getByLabel("Choose file").setInputFiles({
    name: "synthetic.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Corrected synthetic handout version 2.\n"),
  });
  await readyEditor
    .getByRole("button", { name: "Upload and validate" })
    .click();
  await expect(readyEditor.getByRole("status")).toHaveText("Ready to mark", {
    timeout: 40_000,
  });
  await readyEditor.getByRole("button", { name: "Mark ready" }).click();
  await expect(readyEditor.getByRole("status")).toHaveText("Ready", {
    timeout: 40_000,
  });
  await expect(
    page.getByRole("heading", {
      name: /Synthetic protected handout.*version 2/u,
    })
  ).toBeVisible();

  await page.goto(`/sessions/${x.session}`);
  const host = page.getByRole("region", { name: "Session resources" });
  await host.getByRole("button", { name: "Allocate resource" }).click();
  const allocation = host.getByRole("group", {
    name: "Resource allocation editor",
  });
  const item = allocation
    .getByLabel("Library resource")
    .locator("option")
    .filter({ hasText: title });
  await expect(item).toHaveCount(1);
  await allocation
    .getByLabel("Library resource")
    .selectOption((await item.getAttribute("value"))!);
  const version = allocation
    .getByLabel("Ready resource version")
    .locator("option")
    .filter({ hasText: `${title} · version 1` });
  await expect(version).toHaveCount(1);
  const versionId = (await version.getAttribute("value"))!;
  await allocation.getByLabel("Ready resource version").selectOption(versionId);
  await allocation.getByLabel("Shared — current admitted participants").check();
  await allocation
    .getByRole("button", { name: "Preview resource schedule" })
    .click();
  await host.getByRole("button", { name: "Confirm resource schedule" }).click();
  let releasedRequest: Record<string, unknown> | null = null;
  page.on("request", (request) => {
    if (
      !request.url().endsWith("/api/resources") ||
      request.method() !== "POST"
    )
      return;
    const body = request.postDataJSON();
    if (body?.request?.command === "release") releasedRequest = body;
  });
  await host.getByRole("button", { name: "Preview resource release" }).click();
  await host.getByRole("button", { name: "Confirm resource release" }).click();
  const tray = x.guest.getByRole("region", { name: "Resources", exact: true });
  await expect(tray).toContainText(title);
  expect(releasedRequest).not.toBeNull();
  const releaseOperation = (releasedRequest as unknown as { operation: string })
    .operation;
  await expect
    .poll(() =>
      sql(
        `select count(*) from public.resource_commands where operation_id='${releaseOperation}' and session_id='${x.session}';`
      )
    )
    .toBe("1");

  await tray.getByRole("button", { name: "View resource" }).click();
  const href = await tray
    .getByRole("link", { name: "Download protected file" })
    .getAttribute("href");
  expect(href).toContain("/api/resources/file/download?");
  const allowed = await x.guest.evaluate(async (path) => {
    const response = await fetch(path!);
    return {
      status: response.status,
      text: await response.text(),
      cache: response.headers.get("cache-control"),
      disposition: response.headers.get("content-disposition"),
      nosniff: response.headers.get("x-content-type-options"),
    };
  }, href);
  expect(allowed).toMatchObject({
    status: 200,
    text: content,
    cache: "private, no-store",
    nosniff: "nosniff",
  });
  expect(allowed.disposition).toContain("attachment;");
  const range = await x.guest.evaluate(async (path) => {
    const response = await fetch(path!, { headers: { Range: "bytes=0-8" } });
    return {
      status: response.status,
      text: await response.text(),
      range: response.headers.get("content-range"),
    };
  }, href);
  expect(range).toMatchObject({ status: 206, text: content.slice(0, 9) });
  expect(range.range).toMatch(/^bytes 0-8\//u);
  const malformedRange = await x.guest.evaluate(
    async (path) =>
      (await fetch(path!, { headers: { Range: "bytes=0-1048576" } })).status,
    href
  );
  expect(malformedRange).toBe(416);
  const outsider = await browser.newContext();
  expect(
    (await outsider.request.get(`http://127.0.0.1:3100${href}`)).status()
  ).toBe(403);
  await outsider.close();

  const workspace = sql(
    `select workspace_id from public.sessions where id='${x.session}';`
  );
  const removed = await page.evaluate(
    async (body) => {
      const response = await fetch("/api/resources/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return response.json();
    },
    { workspace, command: "delete", version: versionId }
  );
  expect(removed.receipt?.committed).toBe(true);
  expect(
    await x.guest.evaluate(async (path) => (await fetch(path!)).status, href)
  ).toBe(403);

  await host
    .getByRole("button", { name: "Revoke resource for everyone" })
    .click();
  await host
    .getByLabel("Reason for resource revocation")
    .fill("Synthetic withdrawal");
  await host
    .getByRole("button", { name: "Confirm resource withdrawal" })
    .click();
  await expect(host).toContainText("Access withdrawn");
  const denied = await x.guest.evaluate(
    async (path) =>
      (await fetch(path!, { headers: { Range: "bytes=0-8" } })).status,
    href
  );
  expect(denied).toBe(403);
  await expect(tray).not.toContainText(title);
  const replay = await page.evaluate(async (body) => {
    const response = await fetch("/api/resources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return response.json();
  }, releasedRequest);
  expect(replay).toMatchObject({ receipt: { committed: true } });
  await x.context.close();
});

test("crashed staged upload recovers after refresh without a local file or second version", async ({
  page,
}) => {
  test.setTimeout(120_000);
  sql(
    "update public.resource_capability set enabled=true; update public.file_resource_capability set enabled=true;"
  );
  await ownerWithWorkspace(page);
  await page.goto("/resources");
  const workspace = sql(
    "select id from public.workspaces order by created_at desc limit 1;"
  );
  const resource = randomUUID();
  const operation = randomUUID();
  const content = "Synthetic recovery handout\n";
  const digest = createHash("sha256").update(content).digest("hex");
  const request = {
    workspace,
    command: "begin",
    operation,
    resource,
    revision: 0,
    title: "Synthetic recoverable upload",
    filename: "recovery.txt",
    mime: "text/plain",
    size: Buffer.byteLength(content),
    sha256: digest,
  };
  const begun = await page.evaluate(async (input) => {
    const response = await fetch("/api/resources/file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return response.json();
  }, request);
  expect(begun.intent).toMatchObject({ resource, state: "pending" });
  const uploadPath = `/api/resources/file?workspace=${workspace}&intent=${begun.intent.intent}`;
  const wrongOrigin = await page
    .context()
    .request.put(`http://127.0.0.1:3100${uploadPath}`, {
      headers: {
        origin: "http://other.invalid",
        "content-type": "application/octet-stream",
      },
      data: Buffer.from(content),
    });
  expect(wrongOrigin.status()).toBe(403);
  const changed = await page.evaluate(
    async (input) => {
      const response = await fetch("/api/resources/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      return response.json();
    },
    { ...request, title: "Changed after intent" }
  );
  expect(changed.error).toBe("operation_reused");
  // The server acknowledged these bytes, but the browser discards that reply.
  // Refresh must retry the exact staged object, not create another version.
  const ignoredAcknowledgement = await page.evaluate(
    async ({ path, text }) => {
      const response = await fetch(path, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: text,
      });
      return response.status;
    },
    { path: uploadPath, text: content }
  );
  expect(ignoredAcknowledgement).toBe(200);
  // Simulate a worker crash after reserving a retry: the staged bytes remain
  // and the lease has expired, so reconnect must resume this same intent.
  sql(
    `update public.resource_file_intents set state='uploading', upload_lock_until=clock_timestamp()-interval '1 second' where id='${begun.intent.intent}';`
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Synthetic recoverable upload" })
    .click();
  const editor = page
    .getByRole("heading", { name: "File resource", exact: true })
    .locator("..");
  await expect(editor.getByRole("status")).toHaveText("uploading");
  await editor
    .getByRole("button", { name: "Check exact upload result" })
    .click();
  await expect(editor.getByRole("status")).toHaveText("Ready to mark", {
    timeout: 40_000,
  });
  await editor.getByRole("button", { name: "Mark ready" }).click();
  await expect(editor.getByRole("status")).toHaveText("Ready", {
    timeout: 40_000,
  });
  expect(
    sql(
      `select count(*) from public.resource_versions where resource_id='${resource}';`
    )
  ).toBe("1");
  await page.reload();
  await page
    .getByRole("button", { name: "Synthetic recoverable upload" })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Synthetic recoverable upload · version 1",
    })
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete version 1" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Deleted" })
  ).toBeVisible();
  const afterDelete = await page.evaluate(
    async ({ path, text }) => {
      const response = await fetch(path, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: text,
      });
      return response.status;
    },
    { path: uploadPath, text: content }
  );
  expect(afterDelete).toBe(403);
});
