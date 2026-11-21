import { expect, type Browser, type Page } from "@playwright/test";
import { ownerWithWorkspace } from "./browser";
import { sql } from "./database";

export async function prepareWork(page: Page, browser: Browser) {
  await ownerWithWorkspace(page);
  await page.getByLabel("New workshop title").fill("Synthetic individual work");
  await page.getByLabel("New workshop title").press("Enter");
  for (const n of [1, 2]) {
    await page.getByRole("button", { name: "Add activity" }).click();
    const activity = page.locator("fieldset.activity").nth(n - 1);
    await activity.getByLabel("Title", { exact: true }).fill(`Work ${n}`);
    await activity
      .getByLabel("Instructions")
      .fill(`Consider synthetic example ${n}.`);
    await activity.getByLabel("Answer 1 label").fill(`Explanation ${n}`);
    if (n === 1) {
      await activity.getByRole("button", { name: "Add answer field" }).click();
      await activity.getByLabel("Answer 2 label").fill("Decision");
    }
  }
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status")).toHaveText("All changes saved.");
  await page.getByRole("button", { name: "Mark ready to run" }).click();
  await page
    .getByRole("button", { name: "Prepare session from version 1" })
    .click();
  await expect(page).toHaveURL(/\/sessions\//);
  const session = page.url().split("/").at(-1)!;
  sql(`insert into public.execution_capacity values(true,1000,clock_timestamp()+interval '1 hour') on conflict(singleton) do update set max_live=1000,valid_until=excluded.valid_until;
    insert into public.execution_eligibility select workspace_id,clock_timestamp()+interval '1 hour' from public.sessions where id='${session}' on conflict(workspace_id) do update set valid_until=excluded.valid_until;`);
  const context = await browser.newContext();
  const guest = await context.newPage();
  await guest.goto(
    await page.getByLabel("Share this link with participants").inputValue()
  );
  await guest.getByLabel("Your name").fill("Synthetic Ada");
  await guest.getByLabel("Your name").press("Enter");
  await page.getByRole("button", { name: "Admit Synthetic Ada" }).click();
  await expect(guest.getByRole("heading", { name: "You're in" })).toBeVisible();
  await page.getByRole("button", { name: "Preview start" }).click();
  await page.getByRole("button", { name: "Confirm start" }).click();
  await expect(
    guest.getByLabel("Explanation 1", { exact: true })
  ).toBeVisible();
  return { session, guest, context };
}
