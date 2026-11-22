import { expect, test, type Page } from "@playwright/test";
import {
  collectErrors,
  expectAccessible,
  formError,
  ownerWithWorkspace,
} from "../support/browser";

// Requires the local stack (npm run db:start) and a production build.

// Each activity is a fieldset in agenda order.
const activity = (page: Page, number: number) =>
  page.locator("fieldset.activity").nth(number - 1);

const LEAVE_WARNING =
  "You have unsaved changes on this page. Leave without saving them?";

// Answers the next in-page leave confirmation.
function answerLeave(page: Page, leave: boolean) {
  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("confirm");
    expect(dialog.message()).toBe(LEAVE_WARNING);
    await (leave ? dialog.accept() : dialog.dismiss());
  });
}

async function saveDraft(page: Page) {
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status")).toHaveText("All changes saved.");
}

test("a host builds, saves, reorders and freezes an agenda, then starts a new draft and duplicates it", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await ownerWithWorkspace(page);
  await page.getByLabel("New workshop title").fill("Feedback practice");
  await page.getByLabel("New workshop title").press("Enter");
  await expect(
    page.getByRole("heading", { name: "Feedback practice" })
  ).toBeVisible();
  await expect(page.getByText("Editing draft version 1.")).toBeVisible();

  await page.getByRole("button", { name: "Add objective" }).click();
  await page
    .getByLabel("Objective 1", { exact: true })
    .fill("Give specific feedback");

  // Activity 1, built from the keyboard.
  await page.getByRole("button", { name: "Add activity" }).focus();
  await page.keyboard.press("Enter");
  const first = activity(page, 1);
  await first.getByLabel("Title").fill("Think alone");
  await first
    .getByLabel("Instructions")
    .fill("Write what you would say first.");
  await first.getByLabel("Answer 1 label").fill("Your opening");
  await first.getByLabel("Give specific feedback").check();

  await page.getByRole("button", { name: "Add activity" }).click();
  const second = activity(page, 2);
  await second.getByLabel("Title").fill("Compare in groups");
  await second
    .getByLabel("Instructions")
    .fill("Agree on the strongest opening.");
  await second.getByLabel("Who works on it").selectOption("group");
  // Planned minutes can be cleared and retyped, and settle to 1–240 on leaving.
  const minutes = second.getByLabel("Planned minutes");
  await minutes.fill("");
  await minutes.blur();
  await expect(minutes).toHaveValue("1");
  await minutes.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("30");
  await expect(minutes).toHaveValue("30");
  await minutes.fill("999");
  await minutes.blur();
  await expect(minutes).toHaveValue("240");
  await minutes.fill("20");
  await second.getByLabel("Answer 1 label").fill("Agreed opening");
  await second
    .getByLabel("Builds on an earlier answer")
    .selectOption({ label: "Activity 1: Your opening" });
  await expect(page.getByRole("status")).toHaveText(
    "You have unsaved changes."
  );
  await expect(
    page.getByText("Activity 2 isn't linked to an objective.")
  ).toBeVisible();
  await expectAccessible(page);
  await saveDraft(page);
  await expect(
    page.getByText(
      "Activity 2 requires input with the same individual or group ownership."
    )
  ).toBeVisible();
  await second.getByLabel("Who works on it").selectOption("individual");
  await saveDraft(page);
  await expect(
    page.getByText("As last saved, nothing blocks running this agenda.")
  ).toBeVisible();

  // Saved content survives a reload.
  await page.reload();
  await expect(activity(page, 2).getByLabel("Title")).toHaveValue(
    "Compare in groups"
  );
  await expect(
    activity(page, 2).getByLabel("Builds on an earlier answer")
  ).toHaveValue("a1:f1");

  // Moving the dependent activity first is saved, and readiness explains the problem.
  await page.getByRole("button", { name: "Move up: activity 2" }).click();
  await saveDraft(page);
  await expect(
    page.getByText("Activity 1 can only use input from an earlier activity.")
  ).toBeVisible();
  await page.getByRole("button", { name: "Move up: activity 2" }).click();
  await activity(page, 1).getByLabel("Instructions").fill("");

  // Ready to run saves first, then refuses with the remaining problem.
  await page.getByRole("button", { name: "Mark ready to run" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "isn't ready" })
  ).toContainText("Activity 1 needs instructions.");
  await activity(page, 1)
    .getByLabel("Instructions")
    .fill("Write what you would say first.");
  await page.getByRole("button", { name: "Mark ready to run" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Version 1 is ready to run"
  );
  await expect(
    page.getByRole("heading", { name: "Think alone" })
  ).toBeVisible();
  await expectAccessible(page);

  await page.getByRole("button", { name: "Create a new draft" }).click();
  await expect(page.getByText("Editing draft version 2.")).toBeVisible();
  await expect(activity(page, 1).getByLabel("Title")).toHaveValue(
    "Think alone"
  );
  await expect(page.getByText("Version 1: ready to run since")).toBeVisible();

  // In-page ways out ask first while there are unsaved edits.
  await activity(page, 1).getByLabel("Title").fill("Unsaved title");
  answerLeave(page, false);
  await page.getByRole("link", { name: "Back to your workspace" }).click();
  answerLeave(page, false);
  await page.getByRole("button", { name: "Duplicate this workshop" }).click();
  await expect(page.getByText("Editing draft version 2.")).toBeVisible();
  await expect(activity(page, 1).getByLabel("Title")).toHaveValue(
    "Unsaved title"
  );
  answerLeave(page, true);
  await page.getByRole("button", { name: "Duplicate this workshop" }).click();
  await expect(
    page.getByRole("heading", { name: "Copy of Feedback practice" })
  ).toBeVisible();
  // The copy holds the saved agenda, not the abandoned edit.
  await expect(activity(page, 1).getByLabel("Title")).toHaveValue(
    "Think alone"
  );
  await expect(activity(page, 2).getByLabel("Title")).toHaveValue(
    "Compare in groups"
  );
  const copyUrl = page.url();
  await activity(page, 1).getByLabel("Title").fill("Unsaved title");
  answerLeave(page, true);
  await page.getByRole("link", { name: "Back to your workspace" }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  expect(errors).toEqual([]);

  // Closing or reloading the tab with unsaved edits asks the browser first.
  await page.goto(copyUrl);
  await activity(page, 1).getByLabel("Title").fill("Unsaved title");
  const dialog = page.waitForEvent("dialog");
  void page.close({ runBeforeUnload: true });
  const warning = await dialog;
  expect(warning.type()).toBe("beforeunload");
  await warning.accept();
});

test("a create form shown again by Back makes a new workshop, not the earlier one", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await ownerWithWorkspace(page);
  await page.getByLabel("New workshop title").fill("First");
  await page.getByLabel("New workshop title").press("Enter");
  await expect(page.getByRole("heading", { name: "First" })).toBeVisible();
  const first = page.url();
  await page.goBack();
  await page.getByLabel("New workshop title").fill("Second");
  await page.getByLabel("New workshop title").press("Enter");
  await expect(page.getByRole("heading", { name: "Second" })).toBeVisible();
  expect(page.url()).not.toBe(first);
  await page.getByRole("link", { name: "Back to your workspace" }).click();
  await expect(page.getByRole("link", { name: "First" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Second" })).toBeVisible();
});

test("workshop titles are required and bounded", async ({ page }) => {
  test.setTimeout(120_000);
  await ownerWithWorkspace(page);
  await page.getByLabel("New workshop title").fill("   ");
  await page.getByLabel("New workshop title").press("Enter");
  await expect(formError(page)).toHaveText(
    "Enter a workshop title of 1 to 120 characters."
  );
});

test("a save from an out-of-date tab is refused and keeps what the host typed", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await ownerWithWorkspace(page);
  await page.getByLabel("New workshop title").fill("Two tabs");
  await page.getByLabel("New workshop title").press("Enter");
  await expect(page.getByText("Editing draft version 1.")).toBeVisible();
  const otherTab = await page.context().newPage();
  await otherTab.goto(page.url());

  await page.getByRole("button", { name: "Add activity" }).click();
  await activity(page, 1).getByLabel("Title").fill("Saved first");
  await saveDraft(page);

  await otherTab.getByRole("button", { name: "Add activity" }).click();
  await activity(otherTab, 1).getByLabel("Title").fill("Typed in the old tab");
  await otherTab.getByRole("button", { name: "Save draft" }).click();
  await expect(
    otherTab.getByRole("alert").filter({ hasText: "changed somewhere else" })
  ).toBeVisible();
  await expect(activity(otherTab, 1).getByLabel("Title")).toHaveValue(
    "Typed in the old tab"
  );
  await expect(otherTab.getByRole("status")).toHaveText(
    "You have unsaved changes."
  );

  // The first tab's save was not overwritten.
  await page.reload();
  await expect(activity(page, 1).getByLabel("Title")).toHaveValue(
    "Saved first"
  );
  await otherTab.close();
});
