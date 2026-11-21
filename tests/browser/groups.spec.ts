import { expect, test } from "@playwright/test";
import { collectErrors, expectAccessible } from "../support/browser";
import { prepareWork } from "../support/work-browser";

test("AC2/3/6/11/14: keyboard preview, manual correction, group privacy and preserved individual text", async ({
  page,
  browser,
}) => {
  test.setTimeout(240000);
  const { guest, context } = await prepareWork(page, browser);
  const errors = collectErrors(page),
    guestErrors = collectErrors(guest);
  const panel = page.getByRole("region", {
    name: "Session groups",
    exact: true,
  });
  await panel.getByRole("button", { name: "Edit group assignment" }).click();
  await panel.getByRole("button", { name: "Add group", exact: true }).focus();
  await page.keyboard.press("Enter");
  page.once("dialog", (d) => d.accept());
  await panel.getByRole("button", { name: "Suggest random groups" }).click();
  await guest
    .getByLabel("Explanation 1", { exact: true })
    .fill("Private unsaved synthetic work");
  await panel.getByRole("combobox").selectOption("");
  await panel
    .getByLabel(/Reason for changing membership/)
    .fill("Correct random suggestion before confirming");
  await panel.getByRole("button", { name: "Preview changes" }).click();
  await expect(
    panel.getByRole("heading", { name: "Preview group changes" })
  ).toBeFocused();
  await expect(guest.getByRole("region", { name: "Your group" })).toContainText(
    "Unassigned"
  );
  await panel.getByRole("button", { name: "Cancel proposal" }).click();
  await expect(panel).toContainText("revision 0");
  await panel.getByRole("button", { name: "Edit group assignment" }).click();
  await panel.getByRole("button", { name: "Add group", exact: true }).click();
  await panel.getByRole("combobox").selectOption({ index: 1 });
  await panel
    .getByLabel(/Reason for changing membership/)
    .fill("Coordinate the existing individual task");
  await panel.getByRole("button", { name: "Preview changes" }).click();
  await expectAccessible(page);
  await panel.getByRole("button", { name: "Confirm assignment" }).click();
  await expect(panel).toContainText("Confirmed · revision 1");
  await expect(guest.getByRole("region", { name: "Your group" })).toContainText(
    "Group 1"
  );
  await expect(guest.getByLabel("Explanation 1", { exact: true })).toHaveValue(
    "Private unsaved synthetic work"
  );
  await expect(
    guest.getByRole("region", { name: "Your group" })
  ).not.toContainText("Private unsaved synthetic work");
  await expectAccessible(guest);
  expect(errors).toEqual([]);
  expect(guestErrors).toEqual([]);
  await context.setOffline(true);
  await expect(
    guest.getByRole("region", { name: "Your group" }).getByRole("alert")
  ).toContainText("unconfirmed");
  await context.setOffline(false);
  await expect(
    guest.getByRole("region", { name: "Your group" }).getByRole("alert")
  ).not.toBeVisible();
  await expect(guest.getByLabel("Explanation 1", { exact: true })).toHaveValue(
    "Private unsaved synthetic work"
  );
  await context.close();
});

test("AC4/9/11: late roster conflict, navigation guard and lost acknowledgement retry", async ({
  page,
  browser,
}) => {
  test.setTimeout(240000);
  const { guest, context } = await prepareWork(page, browser);
  const panel = page.getByRole("region", {
    name: "Session groups",
    exact: true,
  });
  await panel.getByRole("button", { name: "Edit group assignment" }).click();
  await panel.getByRole("button", { name: "Add group", exact: true }).click();
  await panel.getByRole("combobox").selectOption({ index: 1 });
  await panel
    .getByLabel(/Reason for changing membership/)
    .fill("Keep this proposal");
  const peerContext = await browser.newContext(),
    peer = await peerContext.newPage();
  await peer.goto(
    await page.getByLabel("Share this link with participants").inputValue()
  );
  await peer.getByLabel("Your name").fill("Synthetic Late");
  await peer.getByLabel("Your name").press("Enter");
  // A second host tab handles admission while the protected proposal stays in memory.
  const other = await page.context().newPage();
  await other.goto(page.url());
  await other.getByRole("button", { name: "Admit Synthetic Late" }).click();
  await expect(
    panel.getByRole("button", { name: "Reconcile with current roster" })
  ).toBeVisible();
  await expect(panel.getByLabel(/Reason for changing membership/)).toHaveValue(
    "Keep this proposal"
  );
  let dialogs = 0;
  page.on("dialog", async (d) => {
    dialogs++;
    await d.dismiss();
  });
  await page.getByRole("link", { name: "Back to your workspace" }).click();
  await expect(panel).toBeVisible();
  expect(dialogs).toBe(1);
  await page.goBack();
  await expect.poll(() => dialogs).toBe(2);
  await expect(panel).toBeVisible();
  await panel
    .getByRole("button", { name: "Reconcile with current roster" })
    .click();
  await expect(panel.getByRole("combobox")).toHaveCount(2);
  await panel.getByRole("button", { name: "Preview changes" }).click();
  let lost = false;
  const operations: string[] = [];
  await page.route("**/api/groups", async (route) => {
    const data = route.request().postDataJSON();
    if (data.request) {
      operations.push(data.operation);
      const response = await route.fetch();
      if (!lost) {
        lost = true;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "unavailable", uncertain: true }),
        });
      } else await route.fulfill({ response });
    } else await route.continue();
  });
  await panel.getByRole("button", { name: "Confirm assignment" }).click();
  await expect(
    panel.getByRole("button", { name: "Retry same assignment" })
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Cancel proposal" })
  ).toBeDisabled();
  await panel.getByRole("button", { name: "Retry same assignment" }).click();
  await expect(panel).toContainText("Confirmed · revision 1");
  expect(operations).toHaveLength(2);
  expect(operations[0]).toBe(operations[1]);
  await page.unroute("**/api/groups");
  await expect(guest.getByRole("region", { name: "Your group" })).toContainText(
    "Group 1"
  );
  await expect(peer.getByRole("region", { name: "Your group" })).toContainText(
    "Unassigned"
  );
  await other.getByRole("button", { name: "Remove Synthetic Ada" }).click();
  await expect(
    guest.getByRole("region", { name: "Your group" })
  ).not.toBeVisible();
  await expect(panel).toContainText("revision 2");
  await context.close();
  await peerContext.close();
  await other.close();
});
