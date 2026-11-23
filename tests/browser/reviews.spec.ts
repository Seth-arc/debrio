import { expect, test } from "@playwright/test";
import { prepareWork } from "../support/work-browser";
import { collectErrors, expectAccessible } from "../support/browser";
import { sql } from "../support/database";

test("individual approval, selected-field review, exact retry, withdrawal and offline recovery", async ({
  page,
  browser,
}) => {
  test.setTimeout(240000);
  sql(
    "update public.review_capability set enabled=true;update public.resource_capability set enabled=true;"
  );
  const { guest, context, session } = await prepareWork(page, browser, {
    resources: true,
  });
  let releaseInitial!: () => void,
    initialHeld = false,
    serviceFailed = false;
  const initial = new Promise<void>((resolve) => {
    releaseInitial = resolve;
  });
  await guest.route("**/api/reviews", async (route) => {
    if (
      !initialHeld &&
      route.request().postDataJSON().request?.command === "read"
    ) {
      initialHeld = true;
      const response = await route.fetch();
      await initial;
      await route.fulfill({ response });
    } else if (!serviceFailed) {
      serviceFailed = true;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "unavailable" }),
      });
    } else await route.continue();
  });
  await guest.reload();
  try {
    await expect.poll(() => initialHeld).toBe(true);
    await expect(
      guest.getByRole("region", { name: "Submitted work review", exact: true })
    ).toContainText("Only explicitly authorized fields", { timeout: 8000 });
  } finally {
    releaseInitial();
  }
  await guest.unrouteAll({ behavior: "wait" });
  const errors = collectErrors(page),
    guestErrors = collectErrors(guest);
  const reviewerContext = await browser.newContext({
    viewport: page.viewportSize(),
    ...(process.env.REVIEW_DEMO
      ? {
          recordVideo: {
            dir: ".artifacts/P3-01b/raw",
            size: { width: 1280, height: 720 },
          },
        }
      : {}),
  });
  const reviewer = await reviewerContext.newPage();
  await reviewer.goto(
    await page.getByLabel("Share this link with participants").inputValue()
  );
  await reviewer.getByLabel("Your name").fill("Synthetic Reviewer");
  await reviewer.getByLabel("Your name").press("Enter");
  await page
    .getByRole("button", { name: "Admit Synthetic Reviewer", exact: true })
    .click();
  await expect(
    reviewer.getByRole("heading", { name: "You're in" })
  ).toBeVisible();
  const editor = guest.getByRole("region", {
    name: "Work 1 — current activity",
    exact: true,
  });
  await editor
    .getByLabel("Explanation 1", { exact: true })
    .fill("Synthetic selected answer");
  await editor
    .getByLabel("Decision", { exact: true })
    .fill("Unshared synthetic decision");
  await editor.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    editor.getByText("Saved revision 1", { exact: true })
  ).toBeVisible();
  await editor
    .getByRole("button", { name: "Submit answers", exact: true })
    .click();
  await expect(editor.getByRole("status").first()).toContainText(
    "Submitted complete"
  );
  // Execution previews include the newly committed work and admission context.
  await page.reload();
  await page
    .getByRole("button", { name: "Preview next activity", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm next activity", exact: true })
    .click();
  const host = page.getByRole("region", {
    name: "Submitted work review",
    exact: true,
  });
  const author = guest.getByRole("region", {
    name: "Submitted work review",
    exact: true,
  });
  const tray = reviewer.getByRole("region", { name: "Resources", exact: true });
  await expect(
    host.getByLabel("Exact submitted version").locator("option")
  ).toHaveCount(2);
  await host
    .getByRole("group", { name: "Named reviewers", exact: true })
    .getByLabel(/Synthetic Reviewer/)
    .check();
  let navigationWarnings = 0;
  const dismissNavigation = async (
    dialog: import("@playwright/test").Dialog
  ) => {
    navigationWarnings++;
    await dialog.dismiss();
  };
  page.on("dialog", dismissNavigation);
  await page
    .getByRole("link", { name: "Back to your workspace", exact: true })
    .click();
  expect(navigationWarnings).toBe(1);
  page.off("dialog", dismissNavigation);
  await expect(page).toHaveURL(/\/sessions\//);
  let repairedSelection = false;
  async function propose() {
    await host.getByLabel("Exact submitted version").selectOption({ index: 1 });
    await host
      .getByRole("group", { name: "Selected fields", exact: true })
      .getByLabel("Explanation 1", { exact: true })
      .check();
    await host
      .getByRole("group", { name: "Named reviewers", exact: true })
      .getByLabel(/Synthetic Reviewer/)
      .check();
    if (!repairedSelection) {
      const temporaryContext = await browser.newContext();
      const temporary = await temporaryContext.newPage();
      await temporary.goto(
        await page.getByLabel("Share this link with participants").inputValue()
      );
      await temporary
        .getByLabel("Your name")
        .fill("Synthetic Temporary Reviewer");
      await temporary.getByLabel("Your name").press("Enter");
      const admission = await page.context().newPage();
      await admission.goto(page.url());
      await admission
        .getByRole("button", {
          name: "Admit Synthetic Temporary Reviewer",
          exact: true,
        })
        .click();
      const audience = host.getByRole("group", {
        name: "Named reviewers",
        exact: true,
      });
      await audience.getByLabel(/Synthetic Temporary Reviewer/).check();
      await admission
        .getByRole("button", {
          name: "Remove Synthetic Temporary Reviewer",
          exact: true,
        })
        .click();
      await expect
        .poll(() =>
          sql(
            "select count(*) from public.session_participants where display_name='Synthetic Temporary Reviewer' and state='removed';"
          )
        )
        .toBe("1");
      await admission.close();
      await page.evaluate(() =>
        window.dispatchEvent(new Event("debrio-input-scope-changed"))
      );
      await expect(host).toContainText("is no longer admitted");
      await expect(
        host.getByRole("button", { name: "Save review proposal", exact: true })
      ).toBeDisabled();
      await host
        .getByRole("button", { name: /^Remove unavailable reviewer/ })
        .click();
      await expect(audience.getByLabel(/Synthetic Reviewer/)).toBeChecked();
      await expect(
        host
          .getByRole("group", { name: "Selected fields", exact: true })
          .getByLabel("Explanation 1", { exact: true })
      ).toBeChecked();
      await temporaryContext.close();
      repairedSelection = true;
    }
    await host
      .getByRole("button", { name: "Save review proposal", exact: true })
      .click();
    await expect(
      host.getByRole("button", { name: "Request author approval", exact: true })
    ).toBeVisible();
    await host
      .getByRole("button", { name: "Request author approval", exact: true })
      .click();
  }
  await propose();
  const decline = author.getByRole("button", {
    name: "Decline review sharing",
    exact: true,
  });
  await expect(decline).toBeEnabled();
  await decline.focus();
  await decline.press("Enter");
  await expect(author).toContainText("declined");
  await expect(
    tray.getByRole("button", { name: "View resource", exact: true })
  ).toHaveCount(0);
  await propose();
  await expect(
    author.getByText("Synthetic selected answer", { exact: true })
  ).toHaveCount(2);
  await expect(
    author.getByText("Unshared synthetic decision", { exact: true })
  ).toHaveCount(0);
  await expect(
    tray.getByRole("button", { name: "View resource", exact: true })
  ).toHaveCount(0);
  const approve = author.getByRole("button", {
    name: "Approve this exact review audience",
    exact: true,
  });
  await expect(approve).toBeEnabled();
  await approve.focus();
  await approve.press("Enter");
  await host
    .getByRole("button", {
      name: "Preview named reviewer release",
      exact: true,
    })
    .click();
  await expect(
    host.getByRole("heading", { name: "Submitted work review", exact: true })
  ).toBeFocused();
  const preview = host.getByRole("group", {
    name: "Reviewer release preview",
    exact: true,
  });
  await expect(preview).toContainText("Synthetic Reviewer");
  await expect(preview).toContainText(
    "Individual author approved this exact item"
  );
  await expect(preview).toContainText(
    "Target activity: a2. Current activity: a2."
  );
  let cut = false;
  await page.route("**/api/reviews", async (route) => {
    const r = route.request().postDataJSON();
    if (!cut && r.request?.command === "release") {
      cut = true;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ error: "unavailable", uncertain: true }),
      });
    } else await route.continue();
  });
  await preview
    .getByRole("button", { name: "Confirm reviewer release", exact: true })
    .click();
  await expect(host).toContainText("Result unknown");
  await host
    .getByRole("button", { name: "Retry exact review action", exact: true })
    .click();
  await page.unroute("**/api/reviews");
  await expect(
    tray.getByRole("button", { name: "View resource", exact: true })
  ).toHaveCount(1);
  await tray
    .getByRole("button", { name: "View resource", exact: true })
    .click();
  await expect(
    tray.getByText("Synthetic selected answer", { exact: true })
  ).toBeVisible();
  await expect(
    reviewer.getByText("Unshared synthetic decision", { exact: true })
  ).toHaveCount(0);
  await expectAccessible(page);
  await expectAccessible(guest);
  await expectAccessible(reviewer);
  const earlierHost = page.getByRole("region", {
    name: "Synthetic Ada · Work 1 — earlier work",
    exact: true,
  });
  await earlierHost
    .getByLabel("Reason for host action")
    .fill("Synthetic correction after sharing");
  await earlierHost
    .getByRole("button", { name: "Reopen corrections", exact: true })
    .click();
  const earlier = guest.getByRole("region", {
    name: "Work 1 — earlier work",
    exact: true,
  });
  await earlier
    .getByRole("button", { name: "Edit a correction", exact: true })
    .click();
  await earlier
    .getByLabel("Explanation 1", { exact: true })
    .fill("Synthetic corrected answer version two");
  await earlier
    .getByRole("button", { name: "Save draft", exact: true })
    .click();
  await expect(
    earlier.getByText("Saved revision 2", { exact: true })
  ).toBeVisible();
  await earlier.getByLabel("Correction reason").fill("Synthetic correction");
  await earlier
    .getByRole("button", { name: "Submit answers", exact: true })
    .click();
  await expect(earlier.getByRole("status").first()).toContainText(
    "Submitted complete"
  );
  await reviewer.reload();
  await tray
    .getByRole("button", { name: "View resource", exact: true })
    .click();
  await expect(
    tray.getByText("Synthetic selected answer", { exact: true })
  ).toBeVisible();
  await expect(
    reviewer.getByText("Synthetic corrected answer version two", {
      exact: true,
    })
  ).toHaveCount(0);
  await reviewerContext.setOffline(true);
  await expect(
    tray.getByText("Synthetic selected answer", { exact: true })
  ).toHaveCount(0);
  await reviewerContext.setOffline(false);
  await expect(
    tray.getByText("Synthetic selected answer", { exact: true })
  ).toBeVisible();
  let releaseRead!: () => void,
    heldRead = false;
  const hold = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  await reviewer.route("**/api/resources", async (route) => {
    if (
      !heldRead &&
      (route.request().postDataJSON().request?.command ?? "read") === "read"
    ) {
      const response = await route.fetch();
      heldRead = true;
      await hold;
      await route.fulfill({ response });
    } else await route.continue();
  });
  await expect.poll(() => heldRead).toBe(true);
  const revokedAt = Date.now();
  await author
    .getByRole("button", { name: "Withdraw review permission", exact: true })
    .click();
  await expect(
    tray.getByText("Synthetic selected answer", { exact: true })
  ).toHaveCount(0, { timeout: 6000 });
  expect(Date.now() - revokedAt).toBeLessThan(6000);
  releaseRead();
  await reviewer.unrouteAll({ behavior: "wait" });
  await expect(
    tray.getByText("Synthetic selected answer", { exact: true })
  ).toHaveCount(0);
  await reviewer.reload();
  await expect(
    tray.getByRole("button", { name: "View resource", exact: true })
  ).toHaveCount(0);
  expect(
    sql(
      `select count(*) from public.resource_notices n join public.resource_allocations a on a.id=n.allocation_id where a.session_id='${session}';`
    )
  ).toBe("1");
  expect(errors).toEqual([]);
  expect(guestErrors).toEqual([]);
  await context.close();
  await reviewerContext.close();
});
