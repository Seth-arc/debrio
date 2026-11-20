import { expect, test, type Page } from "@playwright/test";
import {
  collectErrors,
  expectAccessible,
  formError,
  ownerWithWorkspace,
} from "../support/browser";

// Requires the local stack (npm run db:start) and a production build.

// Each stage is a fieldset in agenda order.
const stage = (page: Page, number: number) =>
  page.locator("fieldset.stage").nth(number - 1);

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

  // Stage 1, built from the keyboard.
  await page.getByRole("button", { name: "Add stage" }).focus();
  await page.keyboard.press("Enter");
  const first = stage(page, 1);
  await first.getByLabel("Title").fill("Think alone");
  await first
    .getByLabel("Instructions")
    .fill("Write what you would say first.");
  await first.getByLabel("Answer 1 label").fill("Your opening");
  await first.getByLabel("Give specific feedback").check();

  await page.getByRole("button", { name: "Add stage" }).click();
  const second = stage(page, 2);
  await second.getByLabel("Title").fill("Compare in groups");
  await second
    .getByLabel("Instructions")
    .fill("Agree on the strongest opening.");
  await second.getByLabel("Who works on it").selectOption("group");
  await second.getByLabel("Planned minutes").fill("20");
  await second.getByLabel("Answer 1 label").fill("Agreed opening");
  await second
    .getByLabel("Builds on an earlier answer")
    .selectOption({ label: "Stage 1: Your opening" });
  await expect(page.getByRole("status")).toHaveText(
    "You have unsaved changes."
  );
  await expect(
    page.getByText("Stage 2 isn't linked to an objective.")
  ).toBeVisible();
  await expectAccessible(page);
  await saveDraft(page);
  await expect(
    page.getByText("As last saved, nothing blocks running this agenda.")
  ).toBeVisible();

  // Saved content survives a reload.
  await page.reload();
  await expect(stage(page, 2).getByLabel("Title")).toHaveValue(
    "Compare in groups"
  );
  await expect(
    stage(page, 2).getByLabel("Builds on an earlier answer")
  ).toHaveValue("s1:f1");

  // Moving the dependent stage first is saved, and readiness explains the problem.
  await page.getByRole("button", { name: "Move up: stage 2" }).click();
  await saveDraft(page);
  await expect(
    page.getByText("Stage 1 can only use input from an earlier stage.")
  ).toBeVisible();
  await page.getByRole("button", { name: "Move up: stage 2" }).click();
  await stage(page, 1).getByLabel("Instructions").fill("");

  // Ready to run saves first, then refuses with the remaining problem.
  await page.getByRole("button", { name: "Mark ready to run" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "isn't ready" })
  ).toContainText("Stage 1 needs instructions.");
  await stage(page, 1)
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
  await expect(stage(page, 1).getByLabel("Title")).toHaveValue("Think alone");
  await expect(page.getByText("Version 1: ready to run since")).toBeVisible();

  await page.getByRole("button", { name: "Duplicate this workshop" }).click();
  await expect(
    page.getByRole("heading", { name: "Copy of Feedback practice" })
  ).toBeVisible();
  await expect(stage(page, 2).getByLabel("Title")).toHaveValue(
    "Compare in groups"
  );
  expect(errors).toEqual([]);

  // Leaving with unsaved edits asks first.
  await stage(page, 1).getByLabel("Title").fill("Unsaved title");
  const dialog = page.waitForEvent("dialog");
  void page.close({ runBeforeUnload: true });
  const warning = await dialog;
  expect(warning.type()).toBe("beforeunload");
  await warning.accept();
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

  await page.getByRole("button", { name: "Add stage" }).click();
  await stage(page, 1).getByLabel("Title").fill("Saved first");
  await saveDraft(page);

  await otherTab.getByRole("button", { name: "Add stage" }).click();
  await stage(otherTab, 1).getByLabel("Title").fill("Typed in the old tab");
  await otherTab.getByRole("button", { name: "Save draft" }).click();
  await expect(
    otherTab.getByRole("alert").filter({ hasText: "changed somewhere else" })
  ).toBeVisible();
  await expect(stage(otherTab, 1).getByLabel("Title")).toHaveValue(
    "Typed in the old tab"
  );
  await expect(otherTab.getByRole("status")).toHaveText(
    "You have unsaved changes."
  );

  // The first tab's save was not overwritten.
  await page.reload();
  await expect(stage(page, 1).getByLabel("Title")).toHaveValue("Saved first");
  await otherTab.close();
});
