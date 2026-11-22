import { expect, test, type Page } from "@playwright/test";
import { ownerWithWorkspace, collectErrors } from "../support/browser";
import { prepareWork } from "../support/work-browser";
import { sql } from "../support/database";

test.use({ actionTimeout: 15_000 });

async function libraryWorkspace(page: Page) {
  const read = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/resources") &&
      !!request.postDataJSON()?.workspace
  );
  await page.goto("/resources");
  return (await read).postDataJSON().workspace as string;
}

test("editor detail replies expire and cannot cross authority loss/recovery", async ({
  page,
}) => {
  test.setTimeout(150_000);
  sql("update public.resource_capability set enabled=true;");
  await ownerWithWorkspace(page);
  const errors = collectErrors(page);
  const workspace = await libraryWorkspace(page);
  await page.getByRole("button", { name: "New resource", exact: true }).click();
  const editor = page.getByRole("region", {
    name: "Resource draft",
    exact: true,
  });
  await editor
    .getByLabel("Resource title", { exact: true })
    .fill("Synthetic bounded editor");
  await editor
    .getByLabel("Resource text", { exact: true })
    .fill("Original saved material");
  const created = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/resources") &&
      request.postDataJSON()?.request?.command === "save"
  );
  await editor
    .getByRole("button", { name: "Create resource", exact: true })
    .click();
  const resource = (await created).postDataJSON().request.resource as string;
  await expect(editor.getByRole("status")).toContainText("Saved");

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let captured = false;
  let operation = "";
  await page.route("**/api/resources", async (route) => {
    const request = route.request().postDataJSON();
    if (request.request?.command === "save") operation = request.operation;
    if (request.resource === resource && !request.metadataOnly && !captured) {
      const response = await route.fetch();
      expect((await response.json()).library.resource.content).toBe(
        "My acknowledged edit, retained until verified"
      );
      captured = true;
      await gate;
      await route.fulfill({ response });
    } else await route.continue();
  });
  await editor
    .getByLabel("Resource text", { exact: true })
    .fill("My acknowledged edit, retained until verified");
  await editor
    .getByRole("button", { name: "Save resource draft", exact: true })
    .click();
  await expect.poll(() => captured).toBe(true);
  // This wait crosses the contract's request-start deadline, while metadata stays healthy.
  await page.waitForTimeout(5100);
  release();
  await expect(editor.getByRole("status")).toContainText("Result unknown");
  await expect(editor.getByLabel("Resource text", { exact: true })).toHaveValue(
    "My acknowledged edit, retained until verified"
  );
  await page.unrouteAll({ behavior: "wait" });
  const retried = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/resources") &&
      request.postDataJSON()?.request?.command === "save"
  );
  await editor
    .getByRole("button", { name: "Retry exact resource request", exact: true })
    .click();
  expect((await retried).postDataJSON().operation).toBe(operation);
  await expect(editor.getByRole("status")).toContainText("saved revision 2");

  // A second authorized writer changes the saved revision, leaving this editor's own text dirty.
  const changed = await page.evaluate(
    async ({ workspace, resource }) =>
      (
        await fetch("/api/resources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspace,
            host: true,
            operation: crypto.randomUUID(),
            request: {
              command: "save",
              resource,
              revision: 2,
              title: "Synthetic bounded editor",
              kind: "text",
              content: "New saved comparison after concurrent edit",
            },
          }),
        })
      ).json(),
    { workspace, resource }
  );
  expect(changed.receipt?.committed).toBe(true);
  await editor
    .getByLabel("Resource text", { exact: true })
    .fill("My own conflicting text survives authority changes");
  await editor
    .getByRole("button", { name: "Save resource draft", exact: true })
    .click();
  await expect(editor.getByRole("status")).toContainText("Conflict");
  let deliverComparison!: () => void;
  const comparisonGate = new Promise<void>((resolve) => {
    deliverComparison = resolve;
  });
  let comparisonHeld = false,
    deny = false;
  await page.route("**/api/resources", async (route) => {
    const request = route.request().postDataJSON();
    if (request.metadataOnly && deny) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ error: "not_allowed" }),
      });
    } else if (
      request.resource === resource &&
      !request.metadataOnly &&
      !comparisonHeld
    ) {
      const response = await route.fetch();
      expect((await response.json()).library.resource.content).toBe(
        "New saved comparison after concurrent edit"
      );
      comparisonHeld = true;
      await comparisonGate;
      await route.fulfill({ response });
    } else await route.continue();
  });
  await editor
    .getByRole("button", { name: "Review current saved resource", exact: true })
    .click();
  await expect.poll(() => comparisonHeld).toBe(true);
  deny = true;
  await expect(
    page.getByText(
      "Verifying library access. Saved resource details are hidden; your own unsaved text is retained.",
      { exact: true }
    )
  ).toBeVisible();
  deny = false;
  await expect(
    editor.getByLabel("Resource text", { exact: true })
  ).toBeEnabled();
  deliverComparison();
  await expect(editor.getByRole("alert")).toContainText(
    "Current saved resource unavailable"
  );
  await expect(
    editor.getByRole("group", {
      name: "Reconcile resource conflict",
      exact: true,
    })
  ).toHaveCount(0);
  await expect(editor.getByLabel("Resource text", { exact: true })).toHaveValue(
    "My own conflicting text survives authority changes"
  );
  await page.unrouteAll({ behavior: "wait" });
  await editor
    .getByRole("button", { name: "Review current saved resource", exact: true })
    .click();
  await expect(
    editor.getByRole("group", {
      name: "Reconcile resource conflict",
      exact: true,
    })
  ).toContainText("New saved comparison after concurrent edit");
  expect(errors).toEqual([]);
});

test("library/version pages stay independent and an off-page release renders and acknowledges its notice", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(240_000);
  sql("update public.resource_capability set enabled=true;");
  const x = await prepareWork(page, browser, { resources: true });
  const errors = collectErrors(page);
  const workspace = await libraryWorkspace(page);
  // Seed bounded synthetic material through the same authenticated API used by the UI.
  const resources = await page.evaluate(async (workspace) => {
    const command = async (request: object) => {
      const result = await (
        await fetch("/api/resources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspace,
            host: true,
            operation: crypto.randomUUID(),
            request,
          }),
        })
      ).json();
      if (!result.receipt?.committed)
        throw Error("Synthetic library command failed");
      return result.receipt;
    };
    const rows: { id: string; version: string; title: string }[] = [];
    for (let i = 1; i <= 21; i++) {
      const id = crypto.randomUUID(),
        title = `Paged synthetic resource ${String(i).padStart(2, "0")}`;
      await command({
        command: "save",
        resource: id,
        revision: 0,
        title,
        kind: "text",
        content: `Synthetic content ${i}, version 1`,
      });
      const ready = await command({
        command: "ready",
        resource: id,
        revision: 1,
      });
      rows.push({ id, title, version: ready.version });
    }
    for (let revision = 2; revision <= 21; revision++) {
      await command({
        command: "save",
        resource: rows[0].id,
        revision: revision - 1,
        title: rows[0].title,
        kind: "text",
        content: `Synthetic content 1, version ${revision}`,
      });
      const ready = await command({
        command: "ready",
        resource: rows[0].id,
        revision,
      });
      rows[0].version = ready.version;
    }
    return rows;
  }, workspace);
  const list = page.getByRole("region", {
    name: "Saved resources",
    exact: true,
  });
  await list
    .getByRole("button", { name: "More resources", exact: true })
    .click();
  await list
    .getByRole("button", { name: resources[20].title, exact: true })
    .click();
  const editor = page.getByRole("region", {
    name: "Resource draft",
    exact: true,
  });
  await expect(
    editor.getByRole("heading", {
      name: `${resources[20].title} · version 1`,
      exact: true,
    })
  ).toBeVisible();
  await expect(
    list.getByRole("button", { name: resources[20].title, exact: true })
  ).toBeVisible();
  await list
    .getByRole("button", { name: "Previous resources", exact: true })
    .click();
  await list
    .getByRole("button", { name: resources[0].title, exact: true })
    .click();
  await expect(
    editor.getByRole("heading", {
      name: `${resources[0].title} · version 21`,
      exact: true,
    })
  ).toBeVisible();
  await editor
    .getByRole("button", { name: "Older ready versions", exact: true })
    .click();
  await expect(
    editor.getByRole("heading", {
      name: `${resources[0].title} · version 1`,
      exact: true,
    })
  ).toBeVisible();
  await expect(
    list.getByRole("button", { name: resources[0].title, exact: true })
  ).toBeVisible();
  await expect(
    list.getByRole("button", { name: resources[20].title, exact: true })
  ).toHaveCount(0);

  await page.goto(`/sessions/${x.session}`);
  const panel = page.getByRole("region", {
    name: "Session resources",
    exact: true,
  });
  await panel
    .getByRole("button", { name: "Allocate resource", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "More library resources", exact: true })
    .click();
  await panel
    .getByLabel("Library resource", { exact: true })
    .selectOption(resources[20].id);
  await expect(
    panel.getByLabel("Ready resource version", { exact: true })
  ).toContainText(`${resources[20].title} · version 1`);
  await panel
    .getByLabel("Ready resource version", { exact: true })
    .selectOption(resources[20].version);
  await expect(
    panel.getByLabel("Library resource", { exact: true })
  ).toContainText(resources[20].title);
  await panel
    .getByRole("button", { name: "Cancel allocation edit", exact: true })
    .click();

  await page.evaluate(
    async ({ session, resources }) => {
      const call = async (request: object, operation?: string) => {
        const result = await (
          await fetch("/api/resources", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session, host: true, request, operation }),
          })
        ).json();
        if (result.error) throw Error("Synthetic allocation command failed");
        return result;
      };
      for (let i = 1; i <= 20; i++) {
        const proposal = {
          command: "schedule",
          allocation: `1${session.slice(1, 24)}${String(i).padStart(12, "0")}`,
          revision: 0,
          version: resources[0].version,
          trigger: "manual",
          activity: null,
          selectors: [{ kind: "shared", id: null }],
          restore: [],
          reason: "Synthetic pagination proof",
        };
        const scheduled = await call({ command: "preview", proposal });
        await call(
          { ...proposal, token: scheduled.preview.token },
          crypto.randomUUID()
        );
        const release = { ...proposal, command: "release", revision: 1 };
        const preview = await call({ command: "preview", proposal: release });
        await call(
          { ...release, token: preview.preview.token },
          crypto.randomUUID()
        );
      }
    },
    { session: x.session, resources }
  );
  const tray = x.guest.getByRole("region", { name: "Resources", exact: true });
  await expect(
    tray.getByRole("button", { name: "View resource", exact: true })
  ).toHaveCount(20);
  const lastAllocation = `f${x.session.slice(1, 24)}000000000021`;
  const offPageReleasedAt = await page.evaluate(
    async ({ session, resource, allocation }) => {
      const call = async (request: object, operation?: string) =>
        (
          await fetch("/api/resources", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session, host: true, request, operation }),
          })
        ).json();
      const proposal = {
        command: "schedule",
        allocation,
        revision: 0,
        version: resource.version,
        trigger: "manual",
        activity: null,
        selectors: [{ kind: "shared", id: null }],
        restore: [],
        reason: "Synthetic off-page release",
      };
      let result = await call({ command: "preview", proposal });
      if (!result.preview) throw Error("Preview failed");
      result = await call(
        { ...proposal, token: result.preview.token },
        crypto.randomUUID()
      );
      if (!result.receipt?.committed) throw Error("Schedule failed");
      const release = { ...proposal, command: "release", revision: 1 };
      result = await call({ command: "preview", proposal: release });
      result = await call(
        { ...release, token: result.preview.token },
        crypto.randomUUID()
      );
      if (!result.receipt?.committed) throw Error("Release failed");
      return Date.now();
    },
    { session: x.session, resource: resources[20], allocation: lastAllocation }
  );
  const notice = tray
    .locator("[data-resource-notice]")
    .filter({ hasText: resources[20].title });
  await expect(notice).toBeVisible({ timeout: 2000 });
  const offPageLatency = Date.now() - offPageReleasedAt;
  expect(offPageLatency).toBeLessThanOrEqual(2000);
  await info.attach("local-off-page-notice-latency", {
    body: JSON.stringify({
      latency_ms: offPageLatency,
      network: "local synthetic stack only",
    }),
    contentType: "application/json",
  });
  await expect(
    tray.getByRole("button", { name: "View resource", exact: true })
  ).toHaveCount(20);
  await expect(
    tray.getByRole("heading", {
      name: `${resources[20].title} · version 1`,
      exact: true,
    })
  ).toHaveCount(0);
  await expect
    .poll(async () =>
      page.evaluate(
        async ({ session, allocation }) => {
          const result = await (
            await fetch("/api/resources", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ session, host: true, allocation }),
            })
          ).json();
          return result.snapshot?.detail?.recipients?.[0]?.delivery;
        },
        { session: x.session, allocation: lastAllocation }
      )
    )
    .toBe("Received by active device");
  await notice
    .getByRole("button", { name: "Open new resource", exact: true })
    .click();
  await expect(tray.locator("[data-resource-content]")).toHaveText(
    "Synthetic content 21, version 1"
  );
  expect(errors).toEqual([]);
  await x.context.close();
});
