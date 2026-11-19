import { expect, test } from "@playwright/test";
import {
  collectErrors,
  CONFIRM_FAILED,
  expectAccessible,
  formError,
  freshCode,
  ownerWithWorkspace,
  signIn,
  signUp,
} from "../support/browser";
import {
  confirmationLink,
  SYNTHETIC_PASSWORD,
  syntheticEmail,
} from "../support/local-auth";

// Requires the local stack (npm run db:start) and a production build.
const NEW_PASSWORD = "a brand new passphrase 9";

test("a host resets a forgotten password with email plus authenticator, ending other sessions", async ({
  browser,
  page,
}) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  const { email, secret } = await ownerWithWorkspace(page);
  const otherDevice = await browser.newContext();
  const other = await otherDevice.newPage();
  await signIn(other, email, SYNTHETIC_PASSWORD, secret);

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto("/sign-in");
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await expect(
    page.getByRole("heading", { name: "Reset your password" })
  ).toBeVisible();
  await expectAccessible(page);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Email").press("Enter");
  await expect(
    page.getByRole("heading", { name: "Check your email" })
  ).toBeVisible();
  await expectAccessible(page);

  // The reset link alone is not enough: the authenticator comes next.
  const resetLink = await confirmationLink(email);
  await page.goto(resetLink);
  await expect(page).toHaveURL("/mfa?next=account");
  await page.getByLabel("6-digit code").fill(await freshCode(secret));
  await page.getByLabel("6-digit code").press("Enter");
  await expect(
    page.getByRole("heading", { name: "Account and sign-in" })
  ).toBeVisible();
  await expectAccessible(page);
  await page.getByLabel("New password").fill(NEW_PASSWORD);
  await page.getByLabel("New password").press("Enter");
  await expect(page.getByRole("status")).toHaveText(
    "Password changed. Your other devices were signed out."
  );

  // The other device's session is gone, not just its refresh token.
  await other.goto("/workspace");
  await expect(other).toHaveURL("/sign-in");
  await otherDevice.close();

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto(resetLink);
  await expect(page).toHaveURL(CONFIRM_FAILED);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(SYNTHETIC_PASSWORD);
  await page.getByLabel("Password").press("Enter");
  await expect(formError(page)).toHaveText(
    "The email or password is incorrect."
  );
  await page.getByLabel("Password").fill(NEW_PASSWORD);
  await page.getByLabel("Password").press("Enter");
  await page.getByLabel("6-digit code").fill(await freshCode(secret));
  await page.getByLabel("6-digit code").press("Enter");
  await expect(
    page.getByRole("heading", { name: "Synthetic Practice" })
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("a reset link opened in another browser signs nobody in", async ({
  browser,
  page,
}) => {
  const email = syntheticEmail();
  await signUp(page, email);
  // Signing up again at once hits Auth's per-address limit; the answer must not differ.
  await signUp(page, email);
  await fetch(await confirmationLink(email), { redirect: "manual" });
  // Twice in a row, so the second request hits the same per-address limit.
  for (const attempt of [1, 2]) {
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Email").press("Enter");
    await expect(
      page.getByRole("heading", { name: "Check your email" }),
      `reset request ${attempt}`
    ).toBeVisible();
  }

  // The other browser has no reset verifier, so no session is created there.
  const elsewhere = await browser.newContext();
  const other = await elsewhere.newPage();
  await other.goto(await confirmationLink(email));
  await expect(other).toHaveURL(CONFIRM_FAILED);
  await other.goto("/account");
  await expect(other).toHaveURL("/sign-in");
  await elsewhere.close();
});

test("an owner's email changes only after both addresses confirm", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  const { email } = await ownerWithWorkspace(page);
  const newEmail = syntheticEmail();

  await page.getByRole("link", { name: "Account and sign-in" }).click();
  await expect(
    page.getByRole("heading", { name: "Account and sign-in" })
  ).toBeVisible();
  await page.getByLabel("New email").fill(newEmail);
  await page.getByLabel("New email").press("Enter");
  await expect(page.getByRole("status")).toContainText("Check both inboxes");
  await expect(page.getByText(newEmail)).toBeVisible();
  await expectAccessible(page);

  await page.goto(await confirmationLink(newEmail));
  await expect(page.getByRole("status")).toContainText(
    "One address is confirmed"
  );
  const signedInAs = page.locator("p", { hasText: "Signed in as" });
  await expect(signedInAs).toContainText(email);
  await page.goto(await confirmationLink(email));
  await expect(page.getByRole("status")).toHaveText(
    "Your email address has changed."
  );
  await expect(signedInAs).toContainText(newEmail);

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(SYNTHETIC_PASSWORD);
  await page.getByLabel("Password").press("Enter");
  await expect(formError(page)).toHaveText(
    "The email or password is incorrect."
  );
  await page.getByLabel("Email").fill(newEmail);
  await page.getByLabel("Password").press("Enter");
  await expect(
    page.getByRole("heading", { name: "Enter your authenticator code" })
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("signed-out visitors keep only allow-listed account statuses", async ({
  page,
}) => {
  await page.goto("/account?email=failed");
  await expect(page).toHaveURL("/sign-in?email=failed");
  await expect(page.getByRole("status")).toContainText(
    "That email-change link didn't work"
  );
  await page.goto("/account?email=%3Cscript%3E");
  await expect(page).toHaveURL("/sign-in");
  await page.goto("/mfa?next=https://example.test");
  await expect(page).toHaveURL("/sign-in");
});
