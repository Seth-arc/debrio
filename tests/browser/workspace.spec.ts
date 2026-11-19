import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  confirmationLink,
  SYNTHETIC_PASSWORD,
  syntheticEmail,
} from "../support/local-auth";
import { totp } from "../support/totp";

// Requires the local stack (npm run db:start) and a production build.

async function expectAccessible(page: Page) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}

// Next.js adds its own empty route-announcer alert; target the form message.
const formError = (page: Page) => page.locator("p.form-error[role=alert]");

// Auth may append its error in the URL fragment; the path and query are what we control.
const CONFIRM_FAILED = /\/sign-in\?confirm=failed(#|$)/;

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    // Navigations cancel in-flight route prefetches; that is not an app failure.
    if (request.failure()?.errorText !== "net::ERR_ABORTED")
      errors.push(request.url());
  });
  return errors;
}

// Authenticator codes change every 30 s; never submit the same code twice.
let lastStep = 0;
async function freshCode(secret: string) {
  while (Math.floor(Date.now() / 30_000) === lastStep)
    await new Promise((resolve) => setTimeout(resolve, 500));
  lastStep = Math.floor(Date.now() / 30_000);
  return totp(secret);
}

async function signUp(page: Page, email: string) {
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(SYNTHETIC_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your email" })
  ).toBeVisible();
}

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
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(formError(page)).toContainText("That code didn't match");
  await page.getByLabel("6-digit code").fill(await freshCode(secret));
  await page.getByRole("button", { name: "Verify and continue" }).click();

  await expect(
    page.getByRole("heading", { name: "Create your workspace" })
  ).toBeVisible();
  await expectAccessible(page);
  await page.getByLabel("Workspace name").fill("   ");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(formError(page)).toContainText("1 to 80 characters");
  await page.getByLabel("Workspace name").fill(workspace);
  await page.getByRole("button", { name: "Create workspace" }).click();
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
  await page.getByRole("button", { name: "Verify and continue" }).click();
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
  await expectAccessible(page);
  await page.getByLabel("Password").focus();
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
