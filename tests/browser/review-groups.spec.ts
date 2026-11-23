import { expect, test } from "@playwright/test";
import { prepareWork } from "../support/work-browser";
import { expectAccessible, collectErrors } from "../support/browser";
import { sql } from "../support/database";

test("prospective group rule gates the editor and releases only its selected submitted field", async ({
  page,
  browser,
}) => {
  test.setTimeout(240000);
  sql(
    "update public.review_capability set enabled=true;update public.resource_capability set enabled=true;"
  );
  const { guest, context } = await prepareWork(page, browser, {
    group: true,
    start: false,
  });
  const errors = collectErrors(guest);
  const host = page.getByRole("region", {
    name: "Submitted work review",
    exact: true,
  });
  const member = guest.getByRole("region", {
    name: "Submitted work review",
    exact: true,
  });
  await host.getByLabel("Future group activity").selectOption("a1");
  await host
    .getByRole("button", { name: "Enable group review rule", exact: true })
    .click();
  await expect(host).toContainText("Wait before group contributions");
  await page
    .getByRole("button", { name: "Preview start", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm start", exact: true })
    .click();
  await expect(member).toContainText("including verbally");
  await expect(
    guest.getByLabel("Explanation 1 — group answer", { exact: true })
  ).toHaveCount(0);
  const ack = member.getByRole("button", {
    name: "I have seen this group sharing rule",
    exact: true,
  });
  await ack.focus();
  await ack.press("Enter");
  await expect(member).toContainText("All current members have acknowledged");
  await guest
    .getByLabel("Explanation 1 — group answer", { exact: true })
    .fill("Synthetic disclosed group answer");
  await guest
    .getByLabel("Decision — group answer", { exact: true })
    .fill("Private unselected group decision");
  await guest
    .getByRole("button", { name: "Save group answer", exact: true })
    .click();
  await expect(guest.getByText(/Saved revision 1 at/)).toBeVisible();
  await guest
    .getByRole("button", { name: "Preview group submission", exact: true })
    .click();
  await guest
    .getByRole("button", { name: "Confirm group work change", exact: true })
    .click();
  await expect(
    guest.getByText("Attempt 1 · Submitted complete", { exact: true })
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Preview next activity", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm next activity", exact: true })
    .click();
  const peers = await browser.newContext({
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
  const reviewer = await peers.newPage();
  await reviewer.goto(
    await page.getByLabel("Share this link with participants").inputValue()
  );
  await reviewer.getByLabel("Your name").fill("Synthetic Group Reviewer");
  await reviewer.getByLabel("Your name").press("Enter");
  await page
    .getByRole("button", {
      name: "Admit Synthetic Group Reviewer",
      exact: true,
    })
    .click();
  await expect(
    reviewer.getByRole("heading", { name: "You're in" })
  ).toBeVisible();
  await host.getByLabel("Exact submitted version").selectOption({ index: 1 });
  await host
    .getByRole("group", { name: "Selected fields", exact: true })
    .getByLabel("Explanation 1", { exact: true })
    .check();
  await host
    .getByRole("group", { name: "Named reviewers", exact: true })
    .getByLabel(/Synthetic Group Reviewer/)
    .check();
  await host
    .getByRole("button", { name: "Save review proposal", exact: true })
    .click();
  await expect(
    host.getByRole("button", { name: "Request author approval", exact: true })
  ).toHaveCount(0);
  await host
    .getByRole("button", {
      name: "Preview named reviewer release",
      exact: true,
    })
    .click();
  await expect(
    host.getByRole("group", { name: "Reviewer release preview" })
  ).toContainText("Prospective group sharing rule was disclosed");
  await host
    .getByRole("button", { name: "Confirm reviewer release", exact: true })
    .click();
  const tray = reviewer.getByRole("region", { name: "Resources", exact: true });
  await tray
    .getByRole("button", { name: "View resource", exact: true })
    .click();
  await expect(
    tray.getByText("Synthetic disclosed group answer", { exact: true })
  ).toBeVisible();
  await expect(
    reviewer.getByText("Private unselected group decision", { exact: true })
  ).toHaveCount(0);
  await expect(
    reviewer.getByLabel("Explanation 1 — group answer", { exact: true })
  ).toHaveCount(0);
  await expectAccessible(guest);
  await expectAccessible(reviewer);
  await host
    .getByLabel("Reason for closing or revoking review access")
    .fill("Synthetic review finished");
  await host.getByRole("button", { name: "Close review", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    tray.getByText("Synthetic disclosed group answer", { exact: true })
  ).toHaveCount(0);
  expect(errors).toEqual([]);
  await peers.close();
  await context.close();
});
