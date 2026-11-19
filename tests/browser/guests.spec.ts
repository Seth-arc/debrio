import { expect, test, type Page } from "@playwright/test";
import {
  collectErrors,
  expectAccessible,
  ownerWithWorkspace,
} from "../support/browser";

// Requires the local stack (npm run db:start) and a production build.
// Pages poll every 3 s, so cross-browser changes get a longer wait.
const SOON = { timeout: 10_000 };

async function askToJoin(guest: Page, link: string, name: string) {
  await guest.goto(link);
  await guest.getByLabel("Your name").fill(name);
  await guest.getByLabel("Your name").press("Enter");
  await expect(
    guest.getByRole("heading", { name: "Waiting to be let in" })
  ).toBeVisible();
}

test("a host admits, removes and denies guests; lock, a new link and ending stop new joins", async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  const hostErrors = collectErrors(page);
  await ownerWithWorkspace(page);
  await page.getByLabel("New session title").fill("Synthetic Workshop");
  await page.getByLabel("New session title").press("Enter");
  await expect(
    page.getByRole("heading", { name: "Synthetic Workshop" })
  ).toBeVisible();
  await expectAccessible(page);
  const link = await page
    .getByLabel("Share this link with participants")
    .inputValue();

  const guestBrowser = await browser.newContext();
  const guest = await guestBrowser.newPage();
  const guestErrors = collectErrors(guest);
  await guest.goto(link);
  await expect(
    guest.getByRole("heading", { name: "Join Synthetic Workshop" })
  ).toBeVisible();
  await expectAccessible(guest);
  // A second tab with the join form already open, submitted after the first.
  const secondTab = await guestBrowser.newPage();
  await secondTab.goto(link);
  await askToJoin(guest, link, "Ada Guest");
  await expectAccessible(guest);
  const guestPage = guest.url();
  await secondTab.getByLabel("Your name").fill("Ada Guest");
  await secondTab.getByLabel("Your name").press("Enter");
  await expect(secondTab).toHaveURL(guestPage);
  await secondTab.close();
  // The private credential lives only in an HttpOnly cookie.
  const credential = (await guestBrowser.cookies()).filter(({ name }) =>
    name.startsWith("dg_")
  );
  expect(credential).toHaveLength(1);
  expect(credential[0]).toMatchObject({ httpOnly: true, secure: true });
  // Opening the link again returns to the same place instead of a second request.
  await guest.goto(link);
  await expect(guest).toHaveURL(guestPage);

  // The host's page refreshes itself; admit from the keyboard.
  // Two submissions from one browser still make exactly one request.
  await expect(page.getByRole("status")).toContainText("1 waiting", SOON);
  const admit = page.getByRole("button", { name: "Admit Ada Guest" });
  await expect(admit).toBeVisible();
  await expectAccessible(page);
  await admit.focus();
  await page.keyboard.press("Enter");
  await expect(guest.getByRole("heading", { name: "You're in" })).toBeVisible(
    SOON
  );

  await page.getByRole("button", { name: "Remove Ada Guest" }).click();
  await expect(
    guest.getByRole("heading", { name: "Removed from the session" })
  ).toBeVisible(SOON);

  // Asking again is a new request, which the host can deny.
  await askToJoin(guest, link, "Ada Guest");
  await page.getByRole("button", { name: "Deny Ada Guest" }).click(SOON);
  await expect(guest.getByRole("heading", { name: "Not let in" })).toBeVisible(
    SOON
  );

  // Someone else holding the guest's page address sees nothing.
  const strangerBrowser = await browser.newContext();
  const stranger = await strangerBrowser.newPage();
  await stranger.goto(guestPage);
  await expect(
    stranger.getByRole("heading", { name: "This page isn't available to you" })
  ).toBeVisible();

  await page.getByRole("button", { name: "Close the lobby" }).click();
  await expect(page.getByRole("status")).toContainText("lobby closed");
  await stranger.goto(link);
  await expect(
    stranger.getByRole("heading", {
      name: "The lobby for Synthetic Workshop is closed",
    })
  ).toBeVisible();
  await page.getByRole("button", { name: "Reopen the lobby" }).click();

  await page.getByRole("button", { name: "Replace link" }).click();
  const newLink = page.getByLabel("Share this link with participants");
  await expect(newLink).not.toHaveValue(link);
  await stranger.goto(link);
  await expect(
    stranger.getByRole("heading", { name: "This link doesn't work" })
  ).toBeVisible();
  await stranger.goto(await newLink.inputValue());
  await expect(
    stranger.getByRole("heading", { name: "Join Synthetic Workshop" })
  ).toBeVisible();

  await page.getByText("End session…").click();
  await page.getByRole("button", { name: "End session now" }).click();
  await expect(page.getByRole("status")).toHaveText("This session has ended.");
  await stranger.reload();
  await expect(
    stranger.getByRole("heading", { name: "This session has ended" })
  ).toBeVisible();
  await guest.reload();
  await expect(
    guest.getByRole("heading", { name: "This session has ended" })
  ).toBeVisible();

  await strangerBrowser.close();
  await guestBrowser.close();
  expect(hostErrors).toEqual([]);
  expect(guestErrors).toEqual([]);
});
