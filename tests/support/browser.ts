import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import {
  confirmationLink,
  SYNTHETIC_PASSWORD,
  syntheticEmail,
} from "./local-auth";
import { totp } from "./totp";

// Browser helpers for the sign-in specs. They need the local stack
// (npm run db:start) and a production build.

export async function expectAccessible(page: Page) {
  // Dynamic pages stream their <title> after the content; wait for this page's own.
  await expect(page).toHaveTitle(/Debrio$/);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}

// Next.js adds its own empty route-announcer alert; target the form message.
export const formError = (page: Page) =>
  page.locator("p.form-error[role=alert]");

// Auth may append its error in the URL fragment; the path and query are what we control.
export const CONFIRM_FAILED = /\/sign-in\?confirm=failed(#|$)/;

export function collectErrors(page: Page) {
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
export async function freshCode(secret: string) {
  while (Math.floor(Date.now() / 30_000) === lastStep)
    await new Promise((resolve) => setTimeout(resolve, 500));
  lastStep = Math.floor(Date.now() / 30_000);
  return totp(secret);
}

export async function signUp(page: Page, email: string) {
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(SYNTHETIC_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your email" })
  ).toBeVisible();
  await expectAccessible(page);
}

// A new owner with an authenticator and a workspace, left signed in at AAL2.
export async function ownerWithWorkspace(page: Page) {
  const email = syntheticEmail();
  await signUp(page, email);
  await page.goto(await confirmationLink(email));
  await page.getByRole("button", { name: "Set up authenticator" }).click();
  const secret = (await page.locator(".secret").textContent())!.trim();
  await page.getByLabel("6-digit code").fill(await freshCode(secret));
  await page.getByLabel("6-digit code").press("Enter");
  await page.getByLabel("Workspace name").fill("Synthetic Practice");
  await page.getByLabel("Workspace name").press("Enter");
  await expect(
    page.getByRole("heading", { name: "Synthetic Practice" })
  ).toBeVisible();
  return { email, secret };
}

// Password plus authenticator code; ends on the workspace.
export async function signIn(
  page: Page,
  email: string,
  password: string,
  secret: string
) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByLabel("Password").press("Enter");
  await page.getByLabel("6-digit code").fill(await freshCode(secret));
  await page.getByLabel("6-digit code").press("Enter");
  await expect(
    page.getByRole("heading", { name: "Synthetic Practice" })
  ).toBeVisible();
}
