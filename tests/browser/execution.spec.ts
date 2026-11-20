import { expect, test, type Page } from "@playwright/test";
import {
  collectErrors,
  expectAccessible,
  ownerWithWorkspace,
} from "../support/browser";
import { sql } from "../support/database";
import { localSupabaseEnv } from "../../scripts/local-supabase";

async function prepare(page: Page, group = false) {
  await ownerWithWorkspace(page);
  await page.getByLabel("New workshop title").fill("Synthetic agenda run");
  await page.getByLabel("New workshop title").press("Enter");
  for (const n of [1, 2]) {
    await page.getByRole("button", { name: "Add activity" }).click();
    const activity = page.locator("fieldset.activity").nth(n - 1);
    await activity.getByLabel("Title").fill(`Task ${n}`);
    await activity
      .getByLabel("Instructions")
      .fill(`Consider example ${n} privately.`);
    await activity.getByLabel("Answer 1 label").fill(`Expected answer ${n}`);
    if (group && n === 2)
      await activity.getByLabel("Who works on it").selectOption("group");
  }
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status")).toHaveText("All changes saved.");
  await page.getByRole("button", { name: "Mark ready to run" }).click();
  await expect(page.getByText(/Version 1 is ready to run/)).toBeVisible();
  await page
    .getByRole("button", { name: "Prepare session from version 1" })
    .click();
  if (group) return;
  await expect(page).toHaveURL(/\/sessions\//);
  const id = page.url().split("/").at(-1)!;
  sql(`insert into public.execution_capacity values(true,100,clock_timestamp()+interval '1 hour') on conflict(singleton) do update set max_live=100,valid_until=excluded.valid_until;
    insert into public.execution_eligibility select workspace_id,clock_timestamp()+interval '1 hour' from public.sessions where id='${id}' on conflict(workspace_id) do update set valid_until=excluded.valid_until;`);
  return id;
}

test("AC1–12: host confirms an agenda, guest follows one task, conflicting preview and reconnect recover", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await prepare(page);
  const section = page.getByRole("region", { name: "Session activities" });
  await page.getByRole("button", { name: "Preview start" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Preview activity change" })
  ).toBeFocused();
  await expect(section.getByRole("status")).toHaveText(/Session ready/);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Session activities" })
  ).toBeFocused();

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(
    await page.getByLabel("Share this link with participants").inputValue()
  );
  await guest.getByLabel("Your name").fill("Synthetic Ada");
  await guest.getByLabel("Your name").press("Enter");
  let releaseAdmission!: () => void;
  const admissionHeld = new Promise<void>((resolve) => {
    releaseAdmission = resolve;
  });
  let admissionCommitted = false;
  await page.route("**/sessions/**", async (route) => {
    if (
      route.request().method() === "POST" &&
      route.request().postData()?.includes("admit")
    ) {
      const response = await route.fetch();
      admissionCommitted = true;
      await admissionHeld;
      await route.fulfill({ response });
    } else await route.continue();
  });
  const admit = page.getByRole("button", { name: "Admit Synthetic Ada" });
  await admit.click({ timeout: 10_000 });
  try {
    await expect.poll(() => admissionCommitted).toBe(true);
    // Keep the action pending across the three-second page refresh interval.
    await page.waitForTimeout(3500);
    await expect(admit).toBeDisabled();
  } finally {
    releaseAdmission();
  }
  await expect(admit).toHaveCount(0);
  await page.unroute("**/sessions/**");
  await expect(guest.getByRole("heading", { name: "You're in" })).toBeVisible({
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "Preview start" }).click();
  await page.getByRole("button", { name: "Confirm start" }).click();
  await expect(guest.getByRole("heading", { name: "Task 1" })).toBeVisible();
  await expect(guest.getByText("Host availability is unknown.")).toBeVisible();
  await expect(
    guest.getByText(/facilitator will start the session soon/)
  ).toHaveCount(0);
  await expect(guest.getByText("Consider example 2 privately.")).toHaveCount(0);
  await expect(guest.getByRole("textbox")).toHaveCount(0);
  await expectAccessible(page);
  await expectAccessible(guest);

  const second = await page.context().newPage();
  await second.goto(page.url());
  await page.getByRole("button", { name: "Preview next activity" }).click();
  // Polling and route refresh must retain the focused confirmation and preview.
  await expect(
    page.getByRole("heading", { name: "Preview activity change" })
  ).toBeFocused();
  await second.getByRole("button", { name: "Pause activity" }).click();
  await expect(
    page.getByText(
      "This preview is out of date. Cancel and preview the current activity."
    )
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm next activity" })
  ).toBeDisabled();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await second.getByRole("button", { name: "Resume activity" }).click();
  await expect(
    page.getByRole("button", { name: "Preview next activity" })
  ).toBeVisible();
  await second.close();

  const timings: number[] = [];
  for (const action of [
    "Pause activity",
    "Resume activity",
    "Pause activity",
    "Resume activity",
  ]) {
    const started = Date.now();
    await page.getByRole("button", { name: action }).click();
    await expect(
      guest.getByText(
        action === "Pause activity" ? /Activity paused ·/ : /Activity running ·/
      )
    ).toBeVisible();
    timings.push(Date.now() - started);
  }
  await page.getByRole("button", { name: "Preview next activity" }).click();
  const advance = Date.now();
  await page.getByRole("button", { name: "Confirm next activity" }).click();
  await expect(guest.getByRole("heading", { name: "Task 2" })).toBeVisible();
  timings.push(Date.now() - advance);
  await expect(
    page.getByRole("button", { name: "Preview next activity" })
  ).toHaveCount(0);
  // A known network fault is deliberately excluded from clean-console assertions.
  await guestContext.setOffline(true);
  await expect(
    guest.getByText(/Connection problem. Session state is unavailable/)
  ).toBeVisible();
  await guestContext.setOffline(false);
  const reconnect = Date.now();
  await expect(guest.getByRole("heading", { name: "Task 2" })).toBeVisible({
    timeout: 10_000,
  });
  const reconnectMs = Date.now() - reconnect;
  await guest.reload();
  await expect(guest.getByRole("heading", { name: "Task 2" })).toBeVisible();
  await page.getByRole("button", { name: "End session…", exact: true }).click();
  await page.getByRole("button", { name: "Confirm end session" }).click();
  await expect(
    guest.getByRole("heading", { name: "This session has ended" })
  ).toBeVisible({ timeout: 10_000 });
  await guestContext.close();
  await expectAccessible(page);
  expect(errors).toEqual([]);
  const p95 = [...timings].sort((a, b) => a - b)[
    Math.ceil(timings.length * 0.95) - 1
  ];
  await info.attach("local-task-latency", {
    body: JSON.stringify({ timings, p95, reconnectMs }),
    contentType: "application/json",
  });
  // Video slowing is intentional and is not a latency measurement.
  if (!process.env.DEMO_RECORD) {
    expect(p95).toBeLessThanOrEqual(2000);
    expect(reconnectMs).toBeLessThanOrEqual(10000);
  }
});

test("AC2/7/12: unsupported agenda refusal and expiry handler authorization", async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  await prepare(page, true);
  await expect(
    page.getByRole("alert").filter({ hasText: "needs group assignment" })
  ).toBeVisible();
  await expect(page).toHaveURL(/\/workshops\//);
  expect((await request.post("/api/execution/expire")).status()).toBe(401);
  expect(
    (
      await request.post("/api/execution/expire", {
        headers: {
          authorization: `Bearer ${localSupabaseEnv.EXECUTION_DISPATCH_SECRET}`,
        },
      })
    ).status()
  ).toBe(200);
  expect((await request.post("/api/probe/grant", { data: {} })).status()).toBe(
    404
  );
});

test("AC6/7: lost response retries once and the dispatcher closes an abandoned session", async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  const id = await prepare(page);
  await page.getByRole("button", { name: "Preview start" }).click();
  await page.getByRole("button", { name: "Confirm start" }).click();
  await expect(
    page.getByRole("button", { name: "Pause activity" })
  ).toBeVisible();
  let lost = false;
  await page.route("**/sessions/**", async (route) => {
    if (
      !lost &&
      route.request().method() === "POST" &&
      route.request().postData()?.includes('"pause"')
    ) {
      lost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Pause activity" }).click();
  await expect(
    page.getByRole("button", { name: "Retry the same request" })
  ).toBeEnabled({ timeout: 10_000 });
  expect(lost).toBe(true);
  expect(
    sql(
      `select revision from public.session_execution where session_id='${id}';`
    )
  ).toBe("3");
  await page.getByRole("button", { name: "Retry the same request" }).click();
  await expect(
    page.getByRole("button", { name: "Retry the same request" })
  ).toHaveCount(0);
  expect(
    sql(
      `select revision from public.session_execution where session_id='${id}';`
    )
  ).toBe("3");
  sql(
    `alter table public.session_execution disable trigger execution_identity_frozen; update public.session_execution set started_at=statement_timestamp()-interval '3 hours 53 minutes',deadline=statement_timestamp()+interval '7 minutes' where session_id='${id}'; alter table public.session_execution enable trigger execution_identity_frozen;`
  );
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /This session ends in [78] minutes/ })
  ).toBeVisible();
  await page.close();
  sql(
    `alter table public.session_execution disable trigger execution_identity_frozen; update public.session_execution set started_at=statement_timestamp()-interval '4 hours 1 second',deadline=statement_timestamp()-interval '1 second' where session_id='${id}'; alter table public.session_execution enable trigger execution_identity_frozen;`
  );
  const headers = {
    authorization: `Bearer ${localSupabaseEnv.EXECUTION_DISPATCH_SECRET}`,
  };
  const ended = await request.post("/api/execution/expire", { headers });
  expect(ended.status()).toBe(200);
  expect(
    sql(
      `select s.ended_at=e.deadline from public.sessions s join public.session_execution e on e.session_id=s.id where s.id='${id}' and s.state='ended' and e.state='completed';`
    )
  ).toBe("t");
  // Another browser project's dispatcher may have already swept this session.
  const end = sql(`select ended_at from public.sessions where id='${id}';`);
  expect(
    (await request.post("/api/execution/expire", { headers })).status()
  ).toBe(200);
  expect(sql(`select ended_at from public.sessions where id='${id}';`)).toBe(
    end
  );
});
