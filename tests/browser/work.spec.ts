import { expect, test } from "@playwright/test";
import { collectErrors, expectAccessible } from "../support/browser";
import { prepareWork as prepare } from "../support/work-browser";

test("AC4–9/14: pending typing, two-tab conflict, immutable submission, explicit partial and scoped corrections", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const { guest, context } = await prepare(page, browser);
  const errors = collectErrors(guest);
  const editor = guest.getByRole("region", {
    name: "Work 1 — current activity",
    exact: true,
  });
  const explanation = guest.getByLabel("Explanation 1", { exact: true });
  await explanation.fill("Original synthetic answer");
  let release!: () => void,
    committed = false;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await guest.route("**/api/work", async (route) => {
    const body = route.request().postDataJSON();
    if (body.request?.command === "save") {
      const response = await route.fetch();
      committed = true;
      await held;
      await route.fulfill({ response });
    } else await route.continue();
  });
  await editor.getByRole("button", { name: "Save draft", exact: true }).click();
  try {
    await expect.poll(() => committed).toBe(true);
    await explanation.fill("Text typed during saving");
    await guest.waitForTimeout(3200);
    await expect(explanation).toHaveValue("Text typed during saving");
  } finally {
    release();
  }
  await expect(
    editor.getByText("Unsaved changes", { exact: true })
  ).toBeVisible();
  await guest.unroute("**/api/work");
  await editor.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    editor.getByText("Saved revision 2", { exact: true })
  ).toBeVisible();

  const other = await context.newPage();
  await other.goto(guest.url());
  await expect(other.getByLabel("Explanation 1", { exact: true })).toHaveValue(
    "Text typed during saving"
  );
  await explanation.fill("Preserved local correction");
  await other
    .getByLabel("Explanation 1", { exact: true })
    .fill("Other tab saved answer");
  await other.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    editor.getByRole("region", { name: "Resolve draft conflict" })
  ).toBeVisible();
  await expect(explanation).toHaveValue("Preserved local correction");
  await expect(
    editor.getByText("Other tab saved answer", { exact: true })
  ).toBeVisible();
  await editor
    .getByRole("button", { name: "Keep my text and reconcile" })
    .click();
  await expect(editor.getByRole("heading", { level: 3 })).toBeFocused();
  await editor.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    editor.getByText("Saved revision 4", { exact: true })
  ).toBeVisible();
  guest.once("dialog", (dialog) => dialog.accept());
  await editor
    .getByRole("button", { name: "Submit incomplete work for review" })
    .click();
  await expect(editor.getByRole("status").first()).toContainText(
    "Submitted incomplete"
  );
  const hostWork = page.getByRole("region", {
    name: "Synthetic Ada · Work 1 — current activity",
    exact: true,
  });
  await hostWork
    .getByLabel("Reason for host action")
    .fill("Useful partial response");
  await hostWork.getByRole("button", { name: "Accept partial" }).click();
  await expect(editor.getByRole("status").first()).toContainText(
    "Accepted partial"
  );
  await editor.getByRole("button", { name: "Edit a correction" }).click();
  await guest.getByLabel("Decision", { exact: true }).fill("Proceed");
  await editor.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    editor.getByText("Saved revision 5", { exact: true })
  ).toBeVisible();
  await guest.reload();
  await expect(guest.getByLabel("Decision", { exact: true })).toHaveValue(
    "Proceed"
  );
  await expect(guest.getByLabel("Decision", { exact: true })).toBeEditable();
  await guest.getByLabel("Correction reason").fill("Added the decision");
  await editor
    .getByRole("button", { name: "Submit answers", exact: true })
    .focus();
  await guest.keyboard.press("Enter");
  await expect(editor.getByRole("status").first()).toContainText(
    "Submitted complete"
  );
  await editor.getByText("Submitted versions (2)", { exact: true }).click();
  await expect(
    editor.getByRole("heading", { name: "Submitted version 1", exact: true })
  ).toBeVisible();
  await expect(
    editor.getByText("Host acceptance reason: Useful partial response")
  ).toBeVisible();
  await expect(
    editor.getByRole("heading", { name: "Submitted version 2", exact: true })
  ).toBeVisible();
  await expectAccessible(guest);
  await expectAccessible(page);

  await editor.getByRole("button", { name: "Edit a correction" }).click();
  await explanation.fill("Unsaved at advance");
  await page.getByRole("button", { name: "Preview next activity" }).click();
  await page.getByRole("button", { name: "Confirm next activity" }).click();
  const earlier = guest.getByRole("region", {
    name: "Work 1 — earlier work",
    exact: true,
  });
  await expect(earlier.getByRole("status").first()).toContainText("Read only");
  await expect(explanation).toHaveValue("Unsaved at advance");
  await expect(guest.getByLabel("Explanation 2", { exact: true })).toHaveValue(
    ""
  );
  const earlierHost = page.getByRole("region", {
    name: "Synthetic Ada · Work 1 — earlier work",
    exact: true,
  });
  await earlierHost
    .getByLabel("Reason for host action")
    .fill("Complete the correction");
  await earlierHost.getByRole("button", { name: "Reopen corrections" }).click();
  await expect(
    earlier.getByRole("button", { name: "Save draft", exact: true })
  ).toBeEnabled();
  await earlier
    .getByRole("button", { name: "Save draft", exact: true })
    .click();
  await expect(
    earlier.getByText("Saved revision 6", { exact: true })
  ).toBeVisible();
  await guest.getByLabel("Correction reason").fill("");
  await expect.poll(() => errors).toEqual([]);
  await other.close();
  await context.close();
});

test("AC4/5/11/12/14: lost acknowledgement, reconnect, navigation guard and read-only recovery after end", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const { guest, context, session } = await prepare(page, browser);
  const editor = guest.getByRole("region", {
    name: "Work 1 — current activity",
    exact: true,
  });
  await guest
    .getByLabel("Explanation 1", { exact: true })
    .fill("Acknowledged through retry");
  let lost = false;
  await guest.route("**/api/work", async (route) => {
    if (!lost && route.request().postDataJSON().request?.command === "save") {
      await route.fetch();
      lost = true;
      await route.abort("failed");
    } else await route.continue();
  });
  await editor.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    editor.getByText("Result unknown — retry required", { exact: true })
  ).toBeVisible();
  await guest.unroute("**/api/work");
  await editor.getByRole("button", { name: "Retry same request" }).click();
  await expect(
    editor.getByText("Saved revision 1", { exact: true })
  ).toBeVisible();
  await context.setOffline(true);
  await expect(guest.getByText(/Work service unavailable/)).toBeVisible();
  await context.setOffline(false);
  await expect(
    editor.getByRole("button", { name: "Save draft", exact: true })
  ).toBeEnabled();
  await guest.reload();
  await expect(guest.getByLabel("Explanation 1", { exact: true })).toHaveValue(
    "Acknowledged through retry"
  );
  await guest
    .getByLabel("Explanation 1", { exact: true })
    .fill("Unsaved text for back guard");
  let guardCount = 0;
  const dismissGuard = async (dialog: import("@playwright/test").Dialog) => {
    guardCount++;
    await dialog.dismiss();
  };
  guest.on("dialog", dismissGuard);
  await guest.goBack();
  await expect.poll(() => guardCount).toBe(1);
  await guest.waitForTimeout(300);
  expect(guardCount).toBe(1);
  await guest.goBack();
  await expect.poll(() => guardCount).toBe(2);
  await guest.waitForTimeout(300);
  expect(guardCount).toBe(2);
  guest.off("dialog", dismissGuard);
  await expect(guest.getByLabel("Explanation 1", { exact: true })).toHaveValue(
    "Unsaved text for back guard"
  );
  await editor.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    editor.getByText("Saved revision 2", { exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "End session…" }).click();
  await page.getByRole("button", { name: "Confirm end session" }).click();
  await expect(editor.getByRole("status").first()).toContainText("Read only");
  await guest.reload();
  await expect(guest.getByLabel("Explanation 1", { exact: true })).toHaveValue(
    "Unsaved text for back guard"
  );
  await expect(
    editor.getByRole("button", { name: "Save draft", exact: true })
  ).toBeDisabled();
  const rejected = await guest.evaluate(async (session) => {
    const noOrigin = await fetch("/api/work", { method: "POST", body: "{}" });
    const oversize = await fetch("/api/work", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session, host: false, extra: "x".repeat(262145) }),
    });
    return [noOrigin.status, oversize.status];
  }, session);
  expect(rejected).toEqual([403, 413]);
  await context.close();
});
