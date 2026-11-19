import { expect, test } from "@playwright/test";
import {
  collectErrors,
  CONFIRM_FAILED,
  expectAccessible,
  formError,
  freshCode,
  signUp,
} from "../support/browser";
import {
  confirmationLink,
  SYNTHETIC_PASSWORD,
  syntheticEmail,
} from "../support/local-auth";

// Requires the local stack (npm run db:start) and a production build.

test("an individual secures sign-in, creates a workspace and returns to it", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  const email = syntheticEmail();
  const workspace = "Synthetic Facilitation Practice";

  await page.goto("/");
  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(
    page.getByRole("heading", { name: "Create your account" })
  ).toBeVisible();
  await expectAccessible(page);
  // 40 characters but 80 bytes: over Auth's 72-byte limit, so a password message.
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("é".repeat(40));
  await page.getByLabel("Password").press("Enter");
  await expect(formError(page)).toContainText(
    "Use a password of 12 to 72 characters."
  );
  await signUp(page, email);

  await page.goto(await confirmationLink(email));
  await expect(
    page.getByRole("heading", { name: "Set up your authenticator" })
  ).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("button", { name: "Set up authenticator" }).click();
  const abandoned = (await page.locator(".secret").textContent())!.trim();
  // An abandoned set-up is replaced, not left to block a fresh attempt.
  await page.reload();
  await page.getByRole("button", { name: "Set up authenticator" }).click();
  await expect(page.getByRole("img", { name: /QR code/ })).toBeVisible();
  await expectAccessible(page);
  const secret = (await page.locator(".secret").textContent())!.trim();
  expect(secret).not.toBe(abandoned);

  await page.getByLabel("6-digit code").fill("000000");
  await page.getByLabel("6-digit code").press("Enter");
  await expect(formError(page)).toContainText("That code didn't match");
  await page.getByLabel("6-digit code").fill(await freshCode(secret));
  await page.getByLabel("6-digit code").press("Enter");

  await expect(
    page.getByRole("heading", { name: "Create your workspace" })
  ).toBeVisible();
  await expectAccessible(page);
  await page.getByLabel("Workspace name").fill("   ");
  await page.getByLabel("Workspace name").press("Enter");
  await expect(formError(page)).toContainText("1 to 80 characters");
  await page.getByLabel("Workspace name").fill(workspace);
  await page.getByLabel("Workspace name").press("Enter");
  await expect(page.getByRole("heading", { name: workspace })).toBeVisible();
  await expect(page.getByText("1 authenticator is set up.")).toBeVisible();
  await expectAccessible(page);
  const authCookies = (await page.context().cookies()).filter(({ name }) =>
    name.startsWith("sb-")
  );
  expect(authCookies.length).toBeGreaterThan(0);
  for (const cookie of authCookies)
    expect(cookie).toMatchObject({ httpOnly: true, secure: true });

  // Recovery design: a backup authenticator, added while signed in with MFA.
  await page
    .getByRole("button", { name: "Add a backup authenticator" })
    .click();
  const backupSecret = (await page.locator(".secret").textContent())!.trim();
  expect(backupSecret).not.toBe(secret);
  await page.getByLabel("6-digit code").fill(await freshCode(backupSecret));
  await page.getByLabel("6-digit code").press("Enter");
  await expect(page.getByText("2 authenticators are set up.")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/workspace");
  await expect(page).toHaveURL("/sign-in");

  // Keyboard-only sign-in, first with a wrong password.
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Email")).toBeFocused();
  await page.keyboard.type(email);
  await page.keyboard.press("Tab");
  await page.keyboard.type("not the right password");
  await page.keyboard.press("Enter");
  await expect(formError(page)).toHaveText(
    "The email or password is incorrect."
  );
  await expect(page.getByLabel("Email")).toHaveValue(email);
  await expect(page.getByLabel("Password")).toBeFocused();
  await expectAccessible(page);
  // The same mistake again is announced again: the alert is a fresh node.
  const firstAlert = await formError(page).elementHandle();
  await page.keyboard.press("Enter");
  await expect
    .poll(() => firstAlert!.evaluate((node) => node.isConnected))
    .toBe(false);
  await expect(formError(page)).toHaveText(
    "The email or password is incorrect."
  );
  await expect(page.getByLabel("Password")).toBeFocused();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(SYNTHETIC_PASSWORD);
  await page.keyboard.press("Enter");

  await expect(
    page.getByRole("heading", { name: "Enter your authenticator code" })
  ).toBeVisible();
  // A password alone (AAL1) cannot open the workspace.
  await page.goto("/workspace");
  await expect(page).toHaveURL("/mfa");
  await expectAccessible(page);
  // The backup authenticator's code is accepted as the second step.
  await page.getByLabel("6-digit code").fill(await freshCode(backupSecret));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: workspace })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a confirmation link opened elsewhere or reused signs nobody in", async ({
  browser,
  page,
}) => {
  const email = syntheticEmail();
  await signUp(page, email);
  const link = await confirmationLink(email);

  // Another browser has no sign-up verifier: the address is confirmed, no session is created.
  const elsewhere = await browser.newContext();
  const other = await elsewhere.newPage();
  await other.goto(link);
  await expect(other).toHaveURL(CONFIRM_FAILED);
  await expect(other.getByRole("status")).toContainText("didn't sign you in");
  await expectAccessible(other);
  await other.goto("/workspace");
  await expect(other).toHaveURL("/sign-in");
  await elsewhere.close();

  // The original browser cannot reuse the spent link.
  await page.goto(link);
  await expect(page).toHaveURL(CONFIRM_FAILED);

  // The address was confirmed, so password sign-in now works.
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(SYNTHETIC_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: "Set up your authenticator" })
  ).toBeVisible();
});

test("signed-out visitors cannot open signed-in pages", async ({ page }) => {
  for (const path of ["/workspace", "/mfa"]) {
    await page.goto(path);
    await expect(page).toHaveURL("/sign-in");
  }
});
