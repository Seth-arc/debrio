import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("the shell is accessible and its health link works with the keyboard", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("requestfailed", (request) => errors.push(request.url()));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "A space for better workshops." })
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Check application health" })
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/api/health");
  await expect(page.locator("body")).toContainText('"status":"ok"');
  expect(errors).toEqual([]);
});

test("health is uncached, discloses no configuration and rejects writes", async ({
  request,
}) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["x-frame-options"]).toBe("DENY");
  expect((await request.post("/api/health")).status()).toBe(405);
  expect((await request.get("/missing-page")).status()).toBe(404);
  expect((await request.get("/probe/media")).status()).toBe(404);
  expect((await request.post("/api/probe/grant")).status()).toBe(404);
  expect((await request.get("/probe/monitor")).status()).toBe(404);
  expect((await request.post("/api/probe/monitor")).status()).toBe(404);
});
