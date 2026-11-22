import { expect, test, type Locator } from "@playwright/test";
import { prepareWork } from "../support/work-browser";
import { sql } from "../support/database";
import { expectAccessible, collectErrors } from "../support/browser";

test.use({ actionTimeout: 15_000 });

async function keyboardActivate(control: Locator) {
  await expect(control).toBeEnabled();
  await control.press("Enter");
}

test("synthetic link receipt: explicit host review, keyboard link-out and revoked opening", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  sql("update public.resource_capability set enabled=true;");
  const x = await prepareWork(page, browser, { resources: true });
  const errors = collectErrors(page);
  // A fast client can finish link review before the editor's first clock tick.
  // Keep that boundary deterministic: text confirmation alone is not readiness.
  await page.clock.install({ time: new Date() });
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.goto("/resources");
  let readyRequests = 0;
  page.on("request", (request) => {
    if (
      request.url().endsWith("/api/resources") &&
      request.method() === "POST" &&
      request.postDataJSON().request?.command === "ready"
    )
      readyRequests++;
  });
  await keyboardActivate(
    page.getByRole("button", { name: "New resource", exact: true })
  );
  const editor = page.getByRole("region", {
    name: "Resource draft",
    exact: true,
  });
  await editor
    .getByLabel("Resource title", { exact: true })
    .fill("Synthetic external reading");
  await editor
    .getByLabel("Resource kind", { exact: true })
    .selectOption("link");
  await editor
    .getByLabel("Resource HTTPS URL", { exact: true })
    .fill("https://example.com/synthetic-resource");
  await keyboardActivate(
    editor.getByRole("button", { name: "Create resource", exact: true })
  );
  await expect(editor.getByRole("status")).toContainText("Saved");
  await expect(
    editor.getByRole("button", { name: "Make version ready", exact: true })
  ).toBeDisabled();
  // Trusted disposable DB fixture only: the validator's real TLS/SSRF checks are separate integration proof.
  await page.route("**/api/resources", async (route) => {
    const request = route.request().postDataJSON();
    if (request.request?.command !== "check") {
      await route.continue();
      return;
    }
    const id = request.request.resource;
    expect(id).toMatch(/^[a-f0-9-]{36}$/);
    sql(`insert into public.resource_checks(workspace_id,resource_id,revision,actor_id,auth_session,auth_exp,url_digest,outcome,chain_digest,final_url,checked_at,expires_at)
      select r.workspace_id,r.id,r.revision,r.created_by,s.id,clock_timestamp()+interval '1 hour',encode(extensions.digest(r.content,'sha256'),'hex'),'reachable',repeat('a',64),r.content,clock_timestamp(),clock_timestamp()+interval '5 minutes'
      from public.resources r join auth.sessions s on s.user_id=r.created_by and s.aal='aal2' where r.id='${id}' order by s.created_at desc limit 1;`);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ receipt: { committed: true } }),
    });
  });
  await keyboardActivate(
    editor.getByRole("button", { name: "Check draft link", exact: true })
  );
  await expect(editor).toContainText("HTTP reachable, checked at");
  await expect(editor).toContainText("This may still be a sign-in page.");
  await expect(editor).toContainText(
    "Host reviewed destination: Not confirmed."
  );
  await expect(
    editor.getByRole("button", { name: "Make version ready", exact: true })
  ).toBeDisabled();
  await editor
    .getByRole("checkbox", {
      name: /I reviewed the original and checked final destination/,
    })
    .press("Space");
  await editor
    .getByRole("button", { name: "Confirm host review", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(editor).toContainText("Host reviewed destination: Yes.");
  const ready = editor.getByRole("button", {
    name: "Make version ready",
    exact: true,
  });
  await expect(ready).toBeDisabled();
  await ready.focus();
  await expect(ready).not.toBeFocused();
  await page.keyboard.press("Enter");
  expect(readyRequests).toBe(0);
  await testInfo.attach("link-ready-before-first-clock-tick", {
    body: JSON.stringify({
      reviewed: true,
      readyDisabled: true,
      readyRequests,
    }),
    contentType: "application/json",
  });
  await page.clock.resume();
  await keyboardActivate(ready);
  await expect.poll(() => readyRequests).toBe(1);
  await expect(
    editor.getByRole("heading", {
      name: "Synthetic external reading · version 1",
      exact: true,
    })
  ).toBeVisible();
  await page.unrouteAll({ behavior: "wait" });
  await page.goto(`/sessions/${x.session}`);
  const panel = page.getByRole("region", {
    name: "Session resources",
    exact: true,
  });
  await keyboardActivate(
    panel.getByRole("button", { name: "Allocate resource", exact: true })
  );
  await panel.getByLabel("Library resource").selectOption({ index: 1 });
  await panel
    .getByLabel("Ready resource version")
    .selectOption({ label: "Synthetic external reading · version 1" });
  await panel
    .getByRole("checkbox", {
      name: "Shared — current admitted participants",
      exact: true,
    })
    .press("Space");
  await keyboardActivate(
    panel.getByRole("button", {
      name: "Preview resource schedule",
      exact: true,
    })
  );
  await expect(panel).toContainText("It cannot recall copied URLs");
  await keyboardActivate(
    panel.getByRole("button", {
      name: "Confirm resource schedule",
      exact: true,
    })
  );
  await keyboardActivate(
    panel.getByRole("button", { name: "Preview resource release", exact: true })
  );
  await keyboardActivate(
    panel.getByRole("button", { name: "Confirm resource release", exact: true })
  );
  const tray = x.guest.getByRole("region", { name: "Resources", exact: true });
  await keyboardActivate(
    tray.getByRole("button", { name: "View resource", exact: true })
  );
  const external = tray.getByRole("link", {
    name: "Open external resource",
    exact: true,
  });
  await expect(external).toHaveAttribute("rel", "noopener noreferrer");
  const internal = await external.getAttribute("href");
  const answer = x.guest.getByLabel("Explanation 1", { exact: true });
  await answer.fill("Synthetic unsaved answer survives opening a resource");
  let leaveWarnings = 0;
  x.guest.on("dialog", async (dialog) => {
    leaveWarnings++;
    await dialog.dismiss();
  });
  await x.context.route("https://example.com/**", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html lang='en'><title>Synthetic external material</title><h1>Synthetic external material</h1></html>",
    })
  );
  const popup = x.context.waitForEvent("page");
  await external.focus();
  await x.guest.keyboard.press("Enter");
  const opened = await popup;
  await opened.waitForLoadState();
  expect(await opened.evaluate(() => window.opener === null)).toBe(true);
  expect(await opened.evaluate(() => document.referrer)).toBe("");
  await opened.close();
  await x.guest.bringToFront();
  expect(leaveWarnings).toBe(0);
  await expect(answer).toHaveValue(
    "Synthetic unsaved answer survives opening a resource"
  );
  await keyboardActivate(
    panel.getByRole("button", {
      name: "Revoke resource for everyone",
      exact: true,
    })
  );
  await panel
    .getByLabel("Reason for resource revocation")
    .fill("Synthetic external access withdrawal");
  await keyboardActivate(
    panel.getByRole("button", {
      name: "Confirm resource withdrawal",
      exact: true,
    })
  );
  await expect(
    tray.getByRole("link", { name: "Open external resource", exact: true })
  ).toHaveCount(0);
  const denied = await x.guest.request.get(
    new URL(internal!, x.guest.url()).href,
    { maxRedirects: 0 }
  );
  expect(denied.status()).toBe(403);
  expect(await denied.text()).not.toContain("example.com");
  await expectAccessible(x.guest);
  await testInfo.attach("link-fixture-boundary", {
    body: "Trusted synthetic DB check receipt; external page intercepted locally. This proves UI review/open/revocation behavior, not real external validation. TLS/resolver adversaries are covered separately.",
    contentType: "text/plain",
  });
  expect(errors).toEqual([]);
  await x.context.close();
});
