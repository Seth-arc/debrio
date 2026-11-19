import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  collectErrors,
  expectAccessible,
  ownerWithWorkspace,
  signUp,
} from "../support/browser";
import { confirmationLink, syntheticEmail } from "../support/local-auth";

// Requires the local stack (npm run db:start) and a production build.
// Pages poll every 3 s, so cross-browser changes get a longer wait.
const SOON = { timeout: 10_000 };

async function hostSession(page: Page) {
  await ownerWithWorkspace(page);
  await page.getByLabel("New session title").fill("Synthetic Workshop");
  await page.getByLabel("New session title").press("Enter");
  await expect(
    page.getByRole("heading", { name: "Synthetic Workshop" })
  ).toBeVisible();
  return page.getByLabel("Share this link with participants").inputValue();
}

async function device(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { context, page, errors: collectErrors(page) };
}

test("a host restores a returning guest on a new device, during and after the session", async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  const hostErrors = collectErrors(page);
  const link = await hostSession(page);

  const oldDevice = await device(browser);
  await oldDevice.page.goto(link);
  await oldDevice.page.getByLabel("Your name").fill("Ada Guest");
  await oldDevice.page.getByLabel("Your name").press("Enter");
  await page.getByRole("button", { name: "Admit Ada Guest" }).click(SOON);
  await expect(
    oldDevice.page.getByRole("heading", { name: "You're in" })
  ).toBeVisible(SOON);

  // The lobby is closed to new people, but a returning person can still ask.
  await page.getByRole("button", { name: "Close the lobby" }).click();
  const newDevice = await device(browser);
  await newDevice.page.goto(link);
  await expect(
    newDevice.page.getByRole("heading", {
      name: "The lobby for Synthetic Workshop is closed",
    })
  ).toBeVisible();
  await expectAccessible(newDevice.page);
  await newDevice.page.getByLabel("Your name").fill("Ada on a new laptop");
  await newDevice.page.getByLabel("Your name").press("Enter");
  await expect(
    newDevice.page.getByRole("heading", { name: "Waiting to be let in" })
  ).toBeVisible();

  // The host sees the request marked as returning and picks the identity.
  const restoreAs = page.getByLabel("Restore Ada on a new laptop as");
  await expect(restoreAs).toBeVisible(SOON);
  await expect(page.getByText("Returning")).toBeVisible();
  await expectAccessible(page);
  await restoreAs.selectOption({ index: 0 });
  await expect(restoreAs.locator("option:checked")).toContainText("Ada Guest");
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByRole("status")).toContainText(
    "0 waiting · 1 in the session"
  );

  await expect(
    newDevice.page.getByRole("heading", { name: "You're in" })
  ).toBeVisible(SOON);
  await expect(newDevice.page.getByRole("status")).toContainText("Ada Guest");
  await expect(
    oldDevice.page.getByRole("heading", {
      name: "This place moved to another device",
    })
  ).toBeVisible(SOON);
  await expectAccessible(oldDevice.page);

  // After the session ends, a returning person can still be restored.
  await page.getByText("End session…").click();
  await page.getByRole("button", { name: "End session now" }).click();
  const laterDevice = await device(browser);
  await laterDevice.page.goto(link);
  await expect(
    laterDevice.page.getByRole("heading", { name: "This session has ended" })
  ).toBeVisible();
  await laterDevice.page.getByLabel("Your name").fill("Ada, back later");
  await laterDevice.page.getByLabel("Your name").press("Enter");
  await expect(
    laterDevice.page.getByRole("heading", { name: "Waiting to be let in" })
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "1 waiting to be restored",
    SOON
  );
  const restoreLater = page.getByLabel("Restore Ada, back later as");
  await restoreLater.selectOption({ index: 0 });
  await expect(restoreLater.locator("option:checked")).toContainText(
    "Ada Guest"
  );
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(
    laterDevice.page.getByRole("heading", { name: "This session has ended" })
  ).toBeVisible(SOON);
  await newDevice.page.reload();
  await expect(
    newDevice.page.getByRole("heading", {
      name: "This place moved to another device",
    })
  ).toBeVisible();

  for (const each of [oldDevice, newDevice, laterDevice]) {
    expect(each.errors).toEqual([]);
    await each.context.close();
  }
  expect(hostErrors).toEqual([]);
});

test("joining while signed in shows the account to the host but admits nobody", async ({
  browser,
  page,
}) => {
  test.setTimeout(120_000);
  const link = await hostSession(page);

  // A participant with a confirmed Debrio account, signed in (no authenticator).
  const participant = await device(browser);
  const email = syntheticEmail();
  await signUp(participant.page, email);
  await participant.page.goto(await confirmationLink(email));
  await expect(
    participant.page.getByRole("heading", { name: "Set up your authenticator" })
  ).toBeVisible();

  await participant.page.goto(link);
  await participant.page.getByLabel("Your name").fill("Sam Signed-in");
  await participant.page.getByLabel("Your name").press("Enter");
  await expect(
    participant.page.getByRole("heading", { name: "Waiting to be let in" })
  ).toBeVisible();

  await expect(page.getByText(`signed in as ${email}`)).toBeVisible(SOON);
  await expect(page.getByRole("status")).toContainText(
    "1 waiting · 0 in the session"
  );
  expect(participant.errors).toEqual([]);
  await participant.context.close();
});
