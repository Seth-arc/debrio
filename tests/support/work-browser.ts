import { expect, type Browser, type Page } from "@playwright/test";
import { ownerWithWorkspace } from "./browser";
import { sql } from "./database";

export async function prepareWork(
  page: Page,
  browser: Browser,
  options: { group?: boolean } = {}
) {
  if (options.group)
    sql("update public.group_work_capability set enabled=true;");
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
    if (options.group && n === 1)
      await activity.getByLabel("Who works on it").selectOption("group");
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
  const context = await browser.newContext(
    options.group
      ? {
          viewport: page.viewportSize(),
          isMobile: (page.viewportSize()?.width ?? 1280) < 600,
          ...(process.env.GROUP_DEMO
            ? {
                recordVideo: {
                  dir: ".artifacts/P2-03b/raw",
                  size: { width: 1280, height: 720 },
                },
              }
            : {}),
        }
      : {}
  );
  const guest = await context.newPage();
  await guest.goto(
    await page.getByLabel("Share this link with participants").inputValue()
  );
  await guest.getByLabel("Your name").fill("Synthetic Ada");
  await guest.getByLabel("Your name").press("Enter");
  await page.getByRole("button", { name: "Admit Synthetic Ada" }).click();
  await expect(guest.getByRole("heading", { name: "You're in" })).toBeVisible();
  if (options.group) {
    const groups = page.getByRole("region", {
      name: "Session groups",
      exact: true,
    });
    await groups.getByRole("button", { name: "Edit group assignment" }).click();
    await groups
      .getByRole("button", { name: "Add group", exact: true })
      .click();
    await groups.getByRole("combobox").selectOption({ index: 1 });
    await groups.getByRole("button", { name: "Preview changes" }).click();
    await groups.getByRole("button", { name: "Confirm assignment" }).click();
    const recorder = page.getByRole("group", {
      name: "Recorder for Group 1",
      exact: true,
    });
    await recorder.getByLabel("Choose recorder").selectOption({ index: 1 });
    await recorder
      .getByRole("button", { name: "Preview recorder change" })
      .click();
    await recorder
      .getByRole("button", { name: "Confirm recorder change" })
      .click();
    await expect(
      recorder.getByRole("button", { name: "Confirm recorder change" })
    ).not.toBeVisible();
    await expect(
      page.getByText("Group readiness: ready.", { exact: true })
    ).toBeVisible();
  }
  await page.getByRole("button", { name: "Preview start" }).click();
  await page.getByRole("button", { name: "Confirm start" }).click();
  await expect(
    guest.getByLabel(
      options.group ? "Explanation 1 — group answer" : "Explanation 1",
      { exact: true }
    )
  ).toBeVisible();
  // Begin each scenario with the host panels on the committed live revision.
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Edit group assignment" })
  ).toBeVisible();
  return { session, guest, context };
}
