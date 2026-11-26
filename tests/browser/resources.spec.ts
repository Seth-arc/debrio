import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type Page, type Route } from "@playwright/test";
import {
  ownerWithWorkspace,
  expectAccessible,
  collectErrors,
} from "../support/browser";
import { prepareWork } from "../support/work-browser";
import { sql } from "../support/database";
import { INPUT_SCOPE_CHANGED } from "../../lib/inputs";

test.use({ actionTimeout: 15_000 });

async function createResource(
  page: Page,
  title: string,
  text: string,
  checkInitialGuard = false
) {
  await page.goto("/resources");
  await page.getByRole("button", { name: "New resource", exact: true }).click();
  const editor = page.getByRole("region", {
    name: "Resource draft",
    exact: true,
  });
  await editor.getByLabel("Resource title", { exact: true }).fill(title);
  await editor.getByLabel("Resource text", { exact: true }).fill(text);
  if (checkInitialGuard) {
    let warnings = 0;
    page.once("dialog", async (dialog) => {
      warnings++;
      await dialog.dismiss();
    });
    await page.evaluate(() => window.history.back());
    await expect.poll(() => warnings).toBe(1);
    await expect(
      editor.getByLabel("Resource text", { exact: true })
    ).toHaveValue(text);
  }
  await editor
    .getByRole("button", { name: "Create resource", exact: true })
    .dblclick();
  await expect(editor.getByRole("status")).toContainText("Saved");
  await editor
    .getByRole("button", { name: "Make version ready", exact: true })
    .click();
  await expect(
    editor.getByRole("heading", { name: `${title} · version 1`, exact: true })
  ).toBeVisible();
}

async function scheduleResource(
  page: Page,
  title: string,
  trigger: "start" | "activity" | "manual",
  audience = "shared",
  activity?: string,
  checkPickerAuthority = false
) {
  const panel = page.getByRole("region", {
    name: "Session resources",
    exact: true,
  });
  await panel
    .getByRole("button", { name: "Allocate resource", exact: true })
    .click();
  const editor = panel.getByRole("group", {
    name: "Resource allocation editor",
    exact: true,
  });
  const options = editor.getByLabel("Library resource");
  await expect(
    options.locator("option").filter({ hasText: title })
  ).toHaveCount(1);
  const value = await options
    .locator("option")
    .filter({ hasText: title })
    .getAttribute("value");
  await options.selectOption(value!);
  await expect(
    editor
      .getByLabel("Ready resource version")
      .locator("option")
      .filter({ hasText: `${title} · version 1` })
  ).toHaveCount(1);
  await editor
    .getByLabel("Ready resource version")
    .selectOption({ label: `${title} · version 1` });
  if (checkPickerAuthority) {
    const selected = await editor
      .getByLabel("Ready resource version")
      .inputValue();
    await page.route("**/api/resources", async (route) => {
      const input = route.request().postDataJSON();
      if (input.workspace && input.metadataOnly)
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ error: "not_allowed" }),
        });
      else await route.continue();
    });
    await expect(editor.getByLabel("Ready resource version")).not.toContainText(
      title
    );
    await expect(editor.getByLabel("Ready resource version")).toHaveValue(
      selected
    );
    await page.unrouteAll({ behavior: "wait" });
    await expect(editor.getByLabel("Ready resource version")).toContainText(
      title
    );
  }
  await editor
    .getByLabel("Release resource", { exact: true })
    .selectOption(trigger);
  if (activity)
    await editor
      .getByLabel("Release activity", { exact: true })
      .selectOption(activity);
  if (audience === "group")
    await editor
      .getByRole("group", { name: "Stable session groups", exact: true })
      .getByRole("checkbox")
      .first()
      .check();
  else if (audience === "shared")
    await editor
      .getByLabel("Shared — current admitted participants", { exact: true })
      .check();
  else
    await editor
      .getByRole("group", { name: "Named individuals", exact: true })
      .locator("label")
      .filter({ hasText: audience })
      .getByRole("checkbox")
      .check();
  await editor
    .getByRole("button", { name: "Preview resource schedule", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", {
      name: "Preview resource schedule",
      exact: true,
    })
  ).toBeFocused();
  await panel
    .getByRole("button", { name: "Confirm resource schedule", exact: true })
    .click();
  await expect(
    panel.getByRole("group", {
      name: "Confirm resource allocation",
      exact: true,
    })
  ).toHaveCount(0);
}

test("resource authoring: conflict, exact retry, immutable versions and one navigation warning", async ({
  page,
}) => {
  test.setTimeout(240_000);
  sql("update public.resource_capability set enabled=true;");
  await ownerWithWorkspace(page);
  const errors = collectErrors(page);
  const createdIds = new Set<string>();
  page.on("request", (request) => {
    if (
      !request.url().endsWith("/api/resources") ||
      request.method() !== "POST"
    )
      return;
    const command = request.postDataJSON().request;
    if (command?.command === "save" && command.revision === 0)
      createdIds.add(command.resource);
  });
  await createResource(
    page,
    "Synthetic private brief",
    "Version one: <script>literal text only</script>",
    true
  );
  // A completed create must not retain its intent when Back returns to the library.
  await page.evaluate(() => window.history.back());
  await expect(page).toHaveURL(/\/workspace$/);
  await page
    .getByRole("link", { name: "Resource library", exact: true })
    .press("Enter");
  await expect(
    page.getByRole("button", { name: "New resource", exact: true })
  ).toBeEnabled();
  let allowNewAuthority!: () => void;
  const newAuthorityGate = new Promise<void>((resolve) => {
    allowNewAuthority = resolve;
  });
  let newAuthorityRequests = 0;
  await page.route("**/api/resources", async (route) => {
    const request = route.request().postDataJSON();
    if (request.workspace && request.metadataOnly) {
      newAuthorityRequests++;
      await newAuthorityGate;
    }
    await route.continue();
  });
  await page.evaluate(() => {
    const record = { enabledBeforeAuthority: false };
    const observer = new MutationObserver(() => {
      const input = document.getElementById("resource-title");
      if (input && !input.matches(":disabled"))
        record.enabledBeforeAuthority = true;
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled"],
    });
    Object.assign(window, { newResourceAuthority: { record, observer } });
  });
  await page
    .getByRole("button", { name: "New resource", exact: true })
    .press("Enter");
  const fresh = page.getByRole("region", {
    name: "Resource draft",
    exact: true,
  });
  await expect.poll(() => newAuthorityRequests).toBeGreaterThan(0);
  await expect(
    fresh.getByLabel("Resource title", { exact: true })
  ).toBeDisabled();
  expect(
    await page.evaluate(() => {
      const evidence = (
        window as typeof window & {
          newResourceAuthority: {
            record: { enabledBeforeAuthority: boolean };
            observer: MutationObserver;
          };
        }
      ).newResourceAuthority;
      evidence.observer.disconnect();
      return evidence.record.enabledBeforeAuthority;
    })
  ).toBe(false);
  allowNewAuthority();
  await page.unrouteAll({ behavior: "wait" });
  // Opening a new draft refetches current authoring authority. The heading
  // receives focus immediately; Tab should run after its fields are enabled.
  await expect(
    fresh.getByLabel("Resource title", { exact: true })
  ).toBeEnabled();
  await expect(
    fresh.getByRole("heading", { name: "Resource draft", exact: true })
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    fresh.getByLabel("Resource title", { exact: true })
  ).toBeFocused();
  await page.keyboard.type("New intent after Back");
  await page.keyboard.press("Tab");
  await expect(
    fresh.getByLabel("Resource kind", { exact: true })
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    fresh.getByLabel("Resource text", { exact: true })
  ).toBeFocused();
  await page.keyboard.type("New content belongs to a different resource");
  await page.keyboard.press("Tab");
  await expect(
    fresh.getByRole("button", { name: "Create resource", exact: true })
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(fresh.getByRole("status")).toContainText("Saved");
  expect(createdIds.size).toBe(2);
  await expect(fresh.getByLabel("Resource title", { exact: true })).toHaveValue(
    "New intent after Back"
  );
  await expect(
    fresh.getByLabel("Resource text", { exact: true })
  ).toBeEnabled();
  await fresh.getByLabel("Resource text", { exact: true }).focus();
  await page.keyboard.press("End");
  await page.keyboard.type("; keyboard saved correction");
  await page.keyboard.press("Tab");
  await expect(
    fresh.getByRole("button", { name: "Save resource draft", exact: true })
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(fresh.getByRole("status")).toContainText("saved revision 2");
  await page
    .getByRole("button", { name: "Synthetic private brief", exact: true })
    .press("Enter");
  await expect(fresh.getByLabel("Resource text", { exact: true })).toHaveValue(
    "Version one: <script>literal text only</script>"
  );
  const editor = page.getByRole("region", {
    name: "Resource draft",
    exact: true,
  });
  const second = await page.context().newPage();
  const secondErrors = collectErrors(second);
  await second.bringToFront();
  await second.goto("/resources");
  await second
    .getByRole("button", { name: "Synthetic private brief", exact: true })
    .click();
  const other = second.getByRole("region", {
    name: "Resource draft",
    exact: true,
  });
  await expect(other).toBeVisible();
  await other
    .getByLabel("Resource text", { exact: true })
    .fill("Second tab's unsaved edit");
  await page.bringToFront();
  await editor
    .getByLabel("Resource text", { exact: true })
    .fill("Version two from first tab");
  await editor
    .getByRole("button", { name: "Save resource draft", exact: true })
    .click();
  await expect(editor.getByRole("status")).toContainText("Saved");
  await second.bringToFront();
  await other
    .getByRole("button", { name: "Save resource draft", exact: true })
    .click();
  await expect(other.getByRole("status")).toContainText("Conflict");
  await expect(other.getByLabel("Resource text", { exact: true })).toHaveValue(
    "Second tab's unsaved edit"
  );
  await other
    .getByRole("button", { name: "Review current saved resource", exact: true })
    .click();
  await expect(
    other.getByRole("group", { name: "Reconcile resource conflict" })
  ).toContainText("Version two from first tab");
  await other
    .getByRole("button", {
      name: "Keep my text against this revision",
      exact: true,
    })
    .click();
  await second.route("**/api/resources", async (route) => {
    if (route.request().postDataJSON().request?.command === "save") {
      const result = await route.fetch();
      expect((await result.json()).receipt?.committed).toBe(true);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ error: "unavailable", uncertain: true }),
      });
    } else await route.continue();
  });
  await other
    .getByRole("button", { name: "Save resource draft", exact: true })
    .click();
  await expect(other.getByRole("status")).toContainText("Result unknown");
  await second.unrouteAll({ behavior: "wait" });
  await other
    .getByRole("button", { name: "Retry exact resource request", exact: true })
    .click();
  await expect(other.getByRole("status")).toContainText("Saved");
  await expect(
    other.getByRole("heading", {
      name: "Synthetic private brief · version 1",
      exact: true,
    })
  ).toBeVisible();
  await expect(other.locator("[data-resource-content]")).toHaveText(
    "Version one: <script>literal text only</script>"
  );
  let finish!: () => void;
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await second.route("**/api/resources", async (route) => {
    if (route.request().postDataJSON().request?.command === "ready") await held;
    await route.continue();
  });
  await other
    .getByRole("button", { name: "Make version ready", exact: true })
    .click();
  await expect(
    other.getByLabel("Resource text", { exact: true })
  ).toBeDisabled();
  finish();
  await expect(
    other.getByRole("heading", {
      name: "Synthetic private brief · version 2",
      exact: true,
    })
  ).toBeVisible();
  await second.unrouteAll({ behavior: "wait" });
  await other
    .getByLabel("Resource text", { exact: true })
    .fill("Unsaved text retained through failed reads");
  let warnings = 0;
  const stay = async (dialog: import("@playwright/test").Dialog) => {
    warnings++;
    await dialog.dismiss();
  };
  second.on("dialog", stay);
  await second.evaluate(() => window.history.back());
  await expect.poll(() => warnings).toBe(1);
  await expect(other.getByLabel("Resource text", { exact: true })).toHaveValue(
    "Unsaved text retained through failed reads"
  );
  second.off("dialog", stay);
  await second.route("**/api/resources", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ error: "not_allowed" }),
    })
  );
  await expect(other.locator("[data-resource-content]")).toHaveCount(0);
  await expect(other.getByLabel("Resource text", { exact: true })).toHaveValue(
    "Unsaved text retained through failed reads"
  );
  await second.unrouteAll({ behavior: "wait" });
  await expect(
    other.getByRole("heading", {
      name: "Synthetic private brief · version 1",
      exact: true,
    })
  ).toBeVisible();
  await expectAccessible(second);
  let finishOld!: () => void;
  let oldResource = "";
  const oldReply = new Promise<void>((resolve) => {
    finishOld = resolve;
  });
  await second.route("**/api/resources", async (route) => {
    const request = route.request().postDataJSON();
    if (request.request?.command === "save") {
      oldResource = request.request.resource;
      const response = await route.fetch();
      expect((await response.json()).receipt?.committed).toBe(true);
      await oldReply;
      await route.fulfill({ response });
    } else await route.continue();
  });
  await other
    .getByRole("button", { name: "Save resource draft", exact: true })
    .click();
  await expect.poll(() => oldResource).not.toBe("");
  second.once("dialog", (dialog) => dialog.accept());
  await second
    .getByRole("button", { name: "New resource", exact: true })
    .click();
  await other
    .getByLabel("Resource title", { exact: true })
    .fill("New editor must survive old reply");
  await other
    .getByLabel("Resource text", { exact: true })
    .fill("New unsaved work in editor B");
  const oldRefresh = second.waitForResponse(
    (response) =>
      response.url().endsWith("/api/resources") &&
      response.request().postDataJSON().resource === oldResource &&
      !response.request().postDataJSON().metadataOnly
  );
  finishOld();
  await oldRefresh;
  await second.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
  );
  await expect(other.getByLabel("Resource title", { exact: true })).toHaveValue(
    "New editor must survive old reply"
  );
  await expect(other.getByLabel("Resource text", { exact: true })).toHaveValue(
    "New unsaved work in editor B"
  );
  await second.unrouteAll({ behavior: "wait" });
  second.once("dialog", (dialog) => dialog.accept());
  await second.close();
  expect(errors).toEqual([]);
  expect(secondErrors).toEqual([]);
});

test("an expired host resource preview retains the proposal and requires a fresh preview", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  sql("update public.resource_capability set enabled=true;");
  const x = await prepareWork(page, browser, { start: false, resources: true });
  await createResource(page, "Synthetic expiry brief", "A private example.");
  await page.goto(`/sessions/${x.session}`);
  await scheduleResource(
    page,
    "Synthetic expiry brief",
    "manual",
    "Synthetic Ada"
  );
  const execution = page.getByRole("region", {
    name: "Session activities",
    exact: true,
  });
  await execution.getByRole("button", { name: "Preview start" }).click();
  await execution.getByRole("button", { name: "Confirm start" }).click();
  const panel = page.getByRole("region", {
    name: "Session resources",
    exact: true,
  });
  let heldFirstReleasePreview = false;
  let releaseFirstPreview!: () => void;
  const firstPreviewHeld = new Promise<void>((resolve) => {
    releaseFirstPreview = resolve;
  });
  await page.route("**/api/resources", async (route: Route) => {
    const body = route.request().postDataJSON();
    if (
      !heldFirstReleasePreview &&
      body.request?.command === "preview" &&
      body.request.proposal?.command === "release"
    ) {
      heldFirstReleasePreview = true;
      await firstPreviewHeld;
    }
    await route.continue();
  });
  await panel
    .getByRole("button", { name: "Preview resource release", exact: true })
    .and(page.locator(":enabled"))
    .click();
  await expect(
    panel.getByText(
      "Resource preview timed out. Your selections remain here; preview again.",
      { exact: true }
    )
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    panel.getByRole("group", { name: "Confirm resource allocation" })
  ).not.toBeVisible();
  try {
    await panel
      .getByRole("button", { name: "Preview resource release", exact: true })
      .and(page.locator(":enabled"))
      .click();
    await expect(
      panel.getByRole("group", { name: "Confirm resource allocation" })
    ).toContainText("Synthetic Ada");
  } finally {
    releaseFirstPreview();
  }
  await expect(
    panel.getByRole("group", { name: "Confirm resource allocation" })
  ).toContainText("Synthetic Ada");
});

test("resources: scheduled and manual delivery, scoped notices, revocation, held replies and reconnect preserve work", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(300_000);
  sql("update public.resource_capability set enabled=true;");
  const x = await prepareWork(page, browser, { start: false, resources: true });
  const outsiderContext = await browser.newContext();
  const outsider = await outsiderContext.newPage();
  await outsider.goto(
    await page.getByLabel("Share this link with participants").inputValue()
  );
  await outsider.getByLabel("Your name").fill("Synthetic Bob");
  await outsider.getByLabel("Your name").press("Enter");
  await page
    .getByRole("button", { name: "Admit Synthetic Bob", exact: true })
    .click();
  await expect(
    outsider.getByRole("heading", { name: "You're in", exact: true })
  ).toBeVisible();
  const groups = page.getByRole("region", {
    name: "Session groups",
    exact: true,
  });
  await expect(groups).toContainText("2 admitted people.");
  await groups
    .getByRole("button", { name: "Edit group assignment", exact: true })
    .click();
  await groups.getByRole("button", { name: "Add group", exact: true }).click();
  await groups.getByLabel(/Synthetic Ada/).selectOption({ index: 1 });
  await groups
    .getByRole("button", { name: "Preview changes", exact: true })
    .click();
  await groups
    .getByRole("button", { name: "Confirm assignment", exact: true })
    .click();
  await expect(
    groups.getByRole("button", { name: "Edit group assignment", exact: true })
  ).toBeVisible();
  const errors = collectErrors(x.guest, "net::ERR_INTERNET_DISCONNECTED");
  await createResource(
    page,
    "Synthetic start brief",
    "Private briefing for Ada."
  );
  await createResource(
    page,
    "Synthetic next brief",
    "Next activity's exact instructions."
  );
  await createResource(
    page,
    "Synthetic manual brief",
    "Release only after explicit confirmation."
  );
  await page.goto(`/sessions/${x.session}`);
  await scheduleResource(
    page,
    "Synthetic start brief",
    "start",
    "Synthetic Ada",
    undefined,
    true
  );
  await scheduleResource(
    page,
    "Synthetic next brief",
    "activity",
    "shared",
    "a2"
  );
  await scheduleResource(page, "Synthetic manual brief", "manual", "group");
  const tray = x.guest.getByRole("region", { name: "Resources", exact: true });
  await expect(tray).not.toContainText("Synthetic start brief");
  await expect(tray).not.toContainText("Synthetic manual brief");
  const execution = page.getByRole("region", {
    name: "Session activities",
    exact: true,
  });
  await execution
    .getByRole("button", { name: "Preview start", exact: true })
    .click();
  await expect(
    execution.getByRole("group", { name: "Confirm activity change" })
  ).toContainText("Private briefing for Ada.");
  await execution
    .getByRole("button", { name: "Confirm start", exact: true })
    .click();
  await expect(tray).toContainText("Synthetic start brief");
  await expect(tray).not.toContainText("Synthetic next brief");
  const excludedTray = outsider.getByRole("region", {
    name: "Resources",
    exact: true,
  });
  await expect(excludedTray).not.toContainText("Synthetic start brief");
  const work = x.guest.getByRole("region", {
    name: "Work 1 — current activity",
    exact: true,
  });
  await work
    .getByLabel("Explanation 1", { exact: true })
    .fill("My private unsaved answer stays here");
  const panel = page.getByRole("region", {
    name: "Session resources",
    exact: true,
  });
  let ackFailures = 0;
  await x.guest.route("**/api/resources", async (route) => {
    if (
      route.request().postDataJSON().request?.command === "ack" &&
      ackFailures++ === 0
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1800));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ error: "unavailable", uncertain: true }),
      });
    } else await route.continue();
  });
  await panel
    .getByRole("button", { name: "Preview resource release", exact: true })
    .and(page.locator(":enabled"))
    .click();
  await expect(
    panel.getByRole("group", { name: "Confirm resource allocation" })
  ).toContainText("Synthetic Ada");
  // A legitimate competing host command changes the allocation behind the open preview.
  const refreshedAllocation = page.waitForResponse(async (response) => {
    if (!response.url().endsWith("/api/resources")) return false;
    const request = response.request().postDataJSON();
    if (request.session !== x.session || request.request) return false;
    const result = await response.json();
    return result.snapshot?.items.some(
      (item: { title: string; revision: number }) =>
        item.title === "Synthetic manual brief" && item.revision === 2
    );
  });
  const competing = await page.evaluate(async (session) => {
    const call = async (body: object) =>
      (
        await fetch("/api/resources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session, host: true, ...body }),
        })
      ).json();
    const { snapshot } = await call({});
    const item = snapshot.items.find(
      (candidate: { title: string }) =>
        candidate.title === "Synthetic manual brief"
    );
    const proposal = {
      command: "schedule",
      allocation: item.allocation,
      revision: item.revision,
      version: item.version,
      trigger: item.trigger,
      activity: item.activity,
      selectors: item.selectors,
      restore: [],
      reason: "Synthetic competing schedule confirmation",
    };
    const { preview } = await call({
      request: { command: "preview", proposal },
    });
    return call({
      operation: crypto.randomUUID(),
      request: { ...proposal, token: preview.token },
    });
  }, x.session);
  expect(competing.receipt?.committed).toBe(true);
  await expect(panel.locator("[data-resource-content]")).toHaveCount(0);
  await expect(
    panel.getByRole("group", {
      name: "Resource allocation editor",
      exact: true,
    })
  ).toBeVisible();
  // Preview authority and the list poll are independent. Observe the committed
  // list projection before starting another command from that list.
  await refreshedAllocation;
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  await panel
    .getByRole("button", {
      name: "Use current allocation revision with my selections",
      exact: true,
    })
    .click();
  await expect(
    panel
      .getByRole("group", { name: "Stable session groups", exact: true })
      .getByRole("checkbox")
      .first()
  ).toBeChecked();
  await panel
    .getByRole("button", { name: "Preview resource release", exact: true })
    .and(page.locator(":enabled"))
    .click();
  const committed = page
    .waitForResponse(
      (response) =>
        response.url().endsWith("/api/resources") &&
        response.request().postDataJSON().request?.command === "release"
    )
    .then(async (response) => {
      expect((await response.json()).receipt?.committed).toBe(true);
      return Date.now();
    });
  await panel
    .getByRole("button", { name: "Confirm resource release", exact: true })
    .click();
  const acknowledged = await committed;
  await expect(
    tray
      .locator("[data-resource-notice]")
      .filter({ hasText: "Synthetic manual brief" })
  ).toBeVisible();
  const latency = Date.now() - acknowledged;
  const samples = [latency];
  await testInfo.attach("local-notice-propagation", {
    body: JSON.stringify({
      network: "local disposable stack, synthetic Chromium",
      samples_ms: [latency],
      p95_ms: latency,
      claim: "One sample only; not a hosted capacity claim",
    }),
    contentType: "application/json",
  });
  expect(latency).toBeLessThanOrEqual(2000);
  await expect.poll(() => ackFailures).toBeGreaterThan(1);
  await x.guest.unrouteAll({ behavior: "wait" });
  await expect(panel).toContainText("Received by active device");
  await expect(excludedTray).not.toContainText("Synthetic manual brief");
  await tray
    .locator("[data-resource-notice]")
    .filter({ hasText: "Synthetic manual brief" })
    .getByRole("button", { name: "Dismiss resource notice", exact: true })
    .click();
  await expect(
    tray
      .locator("[data-resource-notice]")
      .filter({ hasText: "Synthetic manual brief" })
  ).toHaveCount(0);
  const changeMembership = async (group: string) => {
    await groups
      .getByRole("button", { name: "Edit group assignment", exact: true })
      .click();
    if (group)
      await groups.getByLabel(/Synthetic Ada/).selectOption({ index: 1 });
    else await groups.getByLabel(/Synthetic Ada/).selectOption("");
    await groups
      .getByLabel(/Reason for changing membership/)
      .fill("Synthetic membership recovery proof");
    await groups
      .getByRole("button", { name: "Preview changes", exact: true })
      .click();
    await groups
      .getByRole("button", { name: "Confirm assignment", exact: true })
      .click();
    await expect(
      groups.getByRole("button", { name: "Edit group assignment", exact: true })
    ).toBeVisible();
  };
  await changeMembership("");
  await expect(tray).not.toContainText("Synthetic manual brief");
  await expect(tray).toContainText("Synthetic start brief");
  await changeMembership("Group 1");
  await expect(tray).not.toContainText("Synthetic manual brief");
  const manualAllocation = panel
    .locator("div")
    .filter({
      has: page.getByRole("heading", {
        name: "Synthetic manual brief · version 1",
        exact: true,
      }),
    })
    .filter({
      has: page.getByRole("button", {
        name: "Update resource audience",
        exact: true,
      }),
    })
    .last();
  await manualAllocation
    .getByRole("button", { name: "Update resource audience", exact: true })
    .click();
  await panel
    .getByLabel("Reason for resource audience change")
    .fill("Explicit inclusion for the new continuous membership");
  await panel
    .getByRole("button", { name: "Preview resource audience", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Confirm resource audience", exact: true })
    .click();
  await expect(
    tray
      .locator("[data-resource-notice]")
      .filter({ hasText: "Synthetic manual brief" })
  ).toBeVisible();
  await tray
    .locator("[data-resource-notice]")
    .filter({ hasText: "Synthetic manual brief" })
    .getByRole("button", { name: "Open new resource", exact: true })
    .click();
  await expect(tray.locator("[data-resource-content]")).toHaveText(
    "Release only after explicit confirmation."
  );
  if (process.env.DEMO_RECORD) {
    await page.screenshot({
      path: ".artifacts/P3-01a/host-delivery.png",
      fullPage: true,
    });
    await x.guest.screenshot({
      path: ".artifacts/P3-01a/participant-resource.png",
      fullPage: true,
    });
  }
  await work.getByLabel("Explanation 1", { exact: true }).focus();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let holding = false;
  await x.guest.route("**/api/resources", async (route) => {
    if (!route.request().postDataJSON().request) {
      const response = await route.fetch();
      holding = true;
      await held;
      await route.fulfill({ response });
    } else await route.continue();
  });
  await expect.poll(() => holding).toBe(true);
  await expect(tray.locator("[data-resource-content]")).toHaveCount(0, {
    timeout: 5500,
  });
  await expect(work.getByLabel("Explanation 1", { exact: true })).toHaveValue(
    "My private unsaved answer stays here"
  );
  await expect(work.getByLabel("Explanation 1", { exact: true })).toBeFocused();
  release();
  await x.guest.unrouteAll({ behavior: "wait" });
  await expect(tray.locator("[data-resource-content]")).toHaveText(
    "Release only after explicit confirmation."
  );
  await x.context.setOffline(true);
  await expect(tray.locator("[data-resource-content]")).toHaveCount(0);
  await expect(tray.locator("[data-resource-notice]")).toHaveCount(0);
  await expect(work.getByLabel("Explanation 1", { exact: true })).toHaveValue(
    "My private unsaved answer stays here"
  );
  await x.context.setOffline(false);
  await expect(tray.locator("[data-resource-content]")).toHaveText(
    "Release only after explicit confirmation."
  );
  await x.guest.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(tray.locator("[data-resource-content]")).toHaveCount(0);
  await expect(tray.locator("[data-resource-notice]")).toHaveCount(0);
  await x.guest.evaluate(() => {
    Reflect.deleteProperty(document, "hidden");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(tray.locator("[data-resource-content]")).toHaveText(
    "Release only after explicit confirmation."
  );
  // Capture a genuinely authorized detail before withdrawal. A later real
  // denial must fence this body even when the old network reply finally arrives.
  let deliverOldDetail!: () => void;
  const oldDetailGate = new Promise<void>((resolve) => {
    deliverOldDetail = resolve;
  });
  let heldAllocation = "";
  await x.guest.route("**/api/resources", async (route) => {
    const request = route.request().postDataJSON();
    if (!request.request && request.allocation && !heldAllocation) {
      const response = await route.fetch();
      const body = await response.json();
      expect(body.snapshot?.detail?.content).toBe(
        "Release only after explicit confirmation."
      );
      heldAllocation = request.allocation;
      await oldDetailGate;
      await route.fulfill({ response });
    } else await route.continue();
  });
  await expect.poll(() => heldAllocation).not.toBe("");
  const actualDenial = x.guest.waitForResponse(async (response) => {
    if (!response.url().endsWith("/api/resources")) return false;
    const request = response.request().postDataJSON();
    return (
      !request.request &&
      request.allocation === heldAllocation &&
      (await response.json()).error === "not_allowed"
    );
  });
  const allocation = panel
    .locator("div")
    .filter({
      has: page.getByRole("heading", {
        name: "Synthetic manual brief · version 1",
        exact: true,
      }),
    })
    .filter({
      has: page.getByRole("button", {
        name: "Revoke resource for everyone",
        exact: true,
      }),
    })
    .last();
  await allocation
    .getByRole("button", { name: "Revoke resource for everyone", exact: true })
    .click();
  await panel
    .getByLabel("Reason for resource revocation")
    .fill("Synthetic withdrawal");
  await panel
    .getByRole("button", { name: "Confirm resource withdrawal", exact: true })
    .click();
  await expect(
    panel.getByRole("group", {
      name: "Confirm resource withdrawal",
      exact: true,
    })
  ).toHaveCount(0);
  await x.guest.evaluate(
    ({ eventName, session }) => {
      window.dispatchEvent(new CustomEvent(eventName, { detail: session }));
    },
    { eventName: INPUT_SCOPE_CHANGED, session: x.session }
  );
  await actualDenial;
  await expect(tray).not.toContainText("Synthetic manual brief");
  await expect(tray).toContainText("Synthetic start brief");
  await x.guest.evaluate(() => {
    const target = document.querySelector(
      '[aria-labelledby="resources-heading"]'
    )!;
    const record = { redisplayed: false };
    const observer = new MutationObserver(() => {
      if (
        target.textContent?.includes("Synthetic manual brief") ||
        target.textContent?.includes(
          "Release only after explicit confirmation."
        )
      )
        record.redisplayed = true;
    });
    observer.observe(target, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    Object.assign(window, { resourceStaleReplay: { record, observer } });
  });
  const replayed = x.guest.waitForResponse(async (response) => {
    if (!response.url().endsWith("/api/resources")) return false;
    const request = response.request().postDataJSON();
    return (
      !request.request &&
      request.allocation === heldAllocation &&
      !!(await response.json()).snapshot?.detail
    );
  });
  deliverOldDetail();
  await replayed;
  await x.guest.unrouteAll({ behavior: "wait" });
  await x.guest.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  expect(
    await x.guest.evaluate(() => {
      const evidence = (
        window as typeof window & {
          resourceStaleReplay: {
            record: { redisplayed: boolean };
            observer: MutationObserver;
          };
        }
      ).resourceStaleReplay;
      evidence.observer.disconnect();
      return evidence.record.redisplayed;
    })
  ).toBe(false);
  await expect(tray).not.toContainText("Synthetic manual brief");
  await expect(tray.locator("[data-resource-content]")).toHaveCount(0);
  await expect(work.getByLabel("Explanation 1", { exact: true })).toHaveValue(
    "My private unsaved answer stays here"
  );
  await work.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(work).toContainText("Saved revision 1");
  await execution
    .getByRole("button", { name: "Preview next activity", exact: true })
    .click();
  await expect(
    execution.getByRole("group", { name: "Confirm activity change" })
  ).toContainText("Next activity's exact instructions.");
  await execution
    .getByRole("button", { name: "Confirm next activity", exact: true })
    .click();
  await expect(tray).toContainText("Synthetic next brief");
  await x.guest.reload();
  await expect(tray).toContainText("Synthetic next brief");
  await expect(tray).not.toContainText("Synthetic manual brief");
  await expectAccessible(x.guest);
  for (let releaseNumber = 0; releaseNumber < 5; releaseNumber++) {
    await scheduleResource(
      page,
      "Synthetic manual brief",
      "manual",
      "Synthetic Ada"
    );
    await panel
      .getByRole("button", { name: "Preview resource release", exact: true })
      .and(page.locator(":enabled"))
      .click();
    const reply = page
      .waitForResponse(
        (response) =>
          response.url().endsWith("/api/resources") &&
          response.request().postDataJSON().request?.command === "release"
      )
      .then(async (response) => {
        expect((await response.json()).receipt?.committed).toBe(true);
        return Date.now();
      });
    await panel
      .getByRole("button", { name: "Confirm resource release", exact: true })
      .click();
    const committedAt = await reply;
    await expect(
      tray
        .locator("[data-resource-notice]")
        .filter({ hasText: "Synthetic manual brief" })
    ).toHaveCount(releaseNumber + 1);
    samples.push(Date.now() - committedAt);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
  await mkdir(".artifacts/P3-01a", { recursive: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed private artifact root and repository-defined Playwright project name.
  await writeFile(
    `.artifacts/P3-01a/notice-propagation-${testInfo.project.name}${process.env.DEMO_RECORD ? "-demo" : ""}.json`,
    JSON.stringify(
      {
        network: "local disposable stack; synthetic recipients",
        samples_ms: samples,
        sorted_ms: sorted,
        p95_ms: p95,
        claim: "Local observation only; no hosted or scale claim",
      },
      null,
      2
    )
  );
  await testInfo.attach("local-notice-propagation-six-releases", {
    body: JSON.stringify({
      network: "local disposable stack, synthetic Chromium",
      samples_ms: samples,
      sorted_ms: sorted,
      p95_ms: p95,
      claim: "Local synthetic observation only; no hosted or scale claim",
    }),
    contentType: "application/json",
  });
  expect(p95).toBeLessThanOrEqual(2000);
  await expect(excludedTray).not.toContainText("Synthetic manual brief");
  await execution
    .getByRole("button", { name: "End session…", exact: true })
    .click();
  await execution
    .getByRole("button", { name: "Confirm end session", exact: true })
    .click();
  await expect(execution).toContainText("Session completed.");
  await x.guest.reload();
  await expect(
    x.guest.getByRole("heading", {
      name: "This session has ended",
      exact: true,
    })
  ).toBeVisible();
  await expect(tray).toContainText("Synthetic next brief");
  await expect(
    tray
      .locator("[data-resource-notice]")
      .filter({ hasText: "Synthetic manual brief" })
  ).toHaveCount(5);
  expect(errors).toEqual([]);
  await x.context.close();
  await outsiderContext.close();
});
