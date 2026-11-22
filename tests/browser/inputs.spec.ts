import { expect, test } from "@playwright/test";
import { prepareWork } from "../support/work-browser";
import { collectErrors, expectAccessible } from "../support/browser";
import { sql } from "../support/database";

test("fixed inputs: exact preview, read-only delivery, revocation, delayed replies, reconnect and safe retry", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const x = await prepareWork(page, browser, { linked: true });
  const errors = collectErrors(x.guest);
  const editor = x.guest.getByRole("region", {
    name: "Work 1 — current activity",
    exact: true,
  });
  await editor
    .getByLabel("Explanation 1", { exact: true })
    .fill("Synthetic fixed version one");
  await editor
    .getByLabel("Decision", { exact: true })
    .fill("Private source detail");
  await editor.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    editor.getByText("Saved revision 1", { exact: true })
  ).toBeVisible();
  x.guest.once("dialog", (d) => d.accept());
  await editor
    .getByRole("button", { name: "Submit answers", exact: true })
    .click();
  await expect(editor.getByRole("status").first()).toContainText(
    "Submitted complete"
  );
  const execution = page.getByRole("region", { name: "Session activities" });
  await expect
    .poll(async () =>
      sql(
        `select count(*) from public.work_attempts where session_id='${x.session}' and activity_id='a1';`
      )
    )
    .toBe("1");
  await expect(execution).toContainText("Session live");
  await expect(execution).toContainText("Fixed input readiness: ready.");
  // Preview is taken from the next polling snapshot, not from the submit acknowledgement.
  await expect
    .poll(async () =>
      execution
        .getByRole("button", { name: "Preview next activity" })
        .isEnabled()
    )
    .toBe(true);
  await execution
    .getByRole("button", { name: "Preview next activity" })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    execution.getByRole("heading", { name: "Preview activity change" })
  ).toBeFocused();
  const confirm = execution.getByRole("group", {
    name: "Confirm activity change",
  });
  // If a poll raced the preview, explicitly cancel and review the current proposal.
  if (await confirm.getByText(/out of date/).isVisible()) {
    await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
    await execution
      .getByRole("button", { name: "Preview next activity" })
      .click();
  }
  await expect(confirm).toContainText("Synthetic fixed version one");
  await expect(confirm).not.toContainText("Private source detail");
  await confirm.getByRole("button", { name: "Confirm next activity" }).click();
  const inputs = x.guest.getByRole("region", {
    name: "Fixed prior-output inputs",
  });
  await expect(inputs.locator("[data-input-value]")).toHaveText(
    "Synthetic fixed version one"
  );
  await expect(inputs).not.toContainText("Private source detail");
  const target = x.guest.getByRole("region", {
    name: "Work 2 — current activity",
    exact: true,
  });
  const answer = target.getByLabel("Explanation 2", { exact: true });
  await expect(answer).toHaveValue("");
  await answer.fill("My unsaved target work");
  const hostInput = page.getByRole("region", {
    name: "Fixed prior-output inputs",
  });
  await hostInput
    .getByRole("button", { name: "Revoke this input delivery" })
    .click();
  await hostInput
    .getByLabel("Reason for input access change")
    .fill("Synthetic access withdrawal");
  await hostInput
    .getByRole("button", { name: "Confirm input access change" })
    .click();
  await expect(inputs.locator("[data-input-value]")).toHaveCount(0);
  await expect(inputs).toContainText("Input access needs host confirmation");
  await expect(answer).toHaveValue("My unsaved target work");
  await expect(answer).toHaveAttribute("readonly", "");
  await hostInput.getByRole("button", { name: "Resolve input access" }).click();
  await expect(
    hostInput.getByRole("heading", { name: "Preview input access" })
  ).toBeFocused();
  await hostInput
    .getByLabel("Reason for input access change")
    .fill("Fresh exact-field confirmation");
  let warnings = 0;
  const stay = async (dialog: import("@playwright/test").Dialog) => {
    warnings++;
    await dialog.dismiss();
  };
  page.on("dialog", stay);
  await page.evaluate(() => window.history.back());
  await expect.poll(() => warnings).toBe(1);
  await expect(
    hostInput.getByLabel("Reason for input access change")
  ).toHaveValue("Fresh exact-field confirmation");
  page.off("dialog", stay);
  let held = false;
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/inputs", async (route) => {
    if (route.request().postDataJSON().request?.command === "resolve") {
      const response = await route.fetch();
      expect((await response.json()).receipt?.committed).toBe(true);
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "unavailable", uncertain: true }),
      });
    } else await route.continue();
  });
  await hostInput
    .getByRole("button", { name: "Confirm input access change" })
    .click();
  await expect(hostInput).toContainText("Result unknown");
  await page.unrouteAll({ behavior: "wait" });
  await hostInput.getByRole("button", { name: "Retry input request" }).click();
  await expect(hostInput).toContainText("Input access updated.");
  await expect(inputs.locator("[data-input-value]")).toHaveText(
    "Synthetic fixed version one"
  );
  await expect(answer).not.toHaveAttribute("readonly", "");
  await target.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    target.getByText("Saved revision 1", { exact: true })
  ).toBeVisible();
  await x.guest.route("**/api/inputs", async (route) => {
    const response = await route.fetch();
    if (!held) {
      held = true;
      await wait;
      await route.fulfill({ response });
    } else
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: '{"error":"not_allowed"}',
      });
  });
  try {
    await expect.poll(() => held).toBe(true);
    await x.context.setOffline(true);
    await x.context.setOffline(false);
    await expect(inputs.locator("[data-input-value]")).toHaveCount(0);
  } finally {
    release();
  }
  await x.guest.waitForTimeout(1000);
  await expect(inputs.locator("[data-input-value]")).toHaveCount(0);
  await x.guest.unrouteAll({ behavior: "wait" });
  await expect(inputs.locator("[data-input-value]")).toHaveText(
    "Synthetic fixed version one"
  );
  await x.context.setOffline(true);
  await expect(inputs.locator("[data-input-value]")).toHaveCount(0);
  await x.context.setOffline(false);
  await expect(inputs.locator("[data-input-value]")).toHaveText(
    "Synthetic fixed version one"
  );
  await x.guest.reload();
  await expect(answer).toHaveValue("My unsaved target work");
  await expect(inputs.locator("[data-input-value]")).toHaveText(
    "Synthetic fixed version one"
  );
  await x.guest.route("**/api/inputs", async (route) => {
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.fulfill({ response });
  });
  await x.guest.reload();
  await expect(inputs.locator("[data-input-value]")).toHaveText(
    "Synthetic fixed version one"
  );
  await x.guest.unrouteAll({ behavior: "wait" });
  let waitingRead = false;
  let releaseReads!: () => void;
  const waitingReads = new Promise<void>((resolve) => {
    releaseReads = resolve;
  });
  await x.guest.route("**/api/inputs", async (route) => {
    const response = await route.fetch();
    waitingRead = true;
    await waitingReads;
    await route.fulfill({ response });
  });
  try {
    await expect.poll(() => waitingRead).toBe(true);
    await expect(inputs.locator("[data-input-value]")).toHaveCount(0, {
      timeout: 6500,
    });
    await x.guest.waitForTimeout(750);
    await expect(inputs.locator("[data-input-value]")).toHaveCount(0);
  } finally {
    releaseReads();
  }
  await x.guest.unrouteAll({ behavior: "wait" });
  await expect(inputs.locator("[data-input-value]")).toHaveText(
    "Synthetic fixed version one"
  );
  // Headless visibility events exercise the same invalidation used by a hidden tab.
  await x.guest.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(inputs.locator("[data-input-value]")).toHaveCount(0);
  await x.guest.evaluate(() => {
    Reflect.deleteProperty(document, "hidden");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(inputs.locator("[data-input-value]")).toHaveText(
    "Synthetic fixed version one"
  );
  await execution.getByRole("button", { name: "End session…" }).click();
  await execution.getByRole("button", { name: "Confirm end session" }).click();
  await x.guest.reload();
  await expect(
    x.guest.getByRole("heading", { name: "This session has ended" })
  ).toBeVisible();
  await expect(inputs.locator("[data-input-value]")).toHaveText(
    "Synthetic fixed version one"
  );
  await expectAccessible(x.guest);
  await expectAccessible(page);
  expect(errors).toEqual([]);
  await x.context.close();
});
