import { expect, test } from "@playwright/test";
import { collectErrors, expectAccessible } from "../support/browser";
import { prepareWork } from "../support/work-browser";

test("AC2/3/4/6/7/8/15: members contribute, recorder changes, immutable snapshots and private individual work", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const x = await prepareWork(page, browser, { group: true });
  const errors = collectErrors(page),
    guestErrors = collectErrors(x.guest);
  const peers = await browser.newContext({
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
    }),
    peer = await peers.newPage();
  await peer.goto(
    await page.getByLabel("Share this link with participants").inputValue()
  );
  await peer.getByLabel("Your name").fill("Synthetic Ben");
  await peer.getByLabel("Your name").press("Enter");
  await page.getByRole("button", { name: "Admit Synthetic Ben" }).click();
  await expect(
    peer.getByText("Waiting for group assignment.", { exact: true })
  ).toBeVisible();
  const groups = page.getByRole("region", {
    name: "Session groups",
    exact: true,
  });
  await expect(groups).toContainText("2 admitted people.");
  await groups.getByRole("button", { name: "Edit group assignment" }).click();
  for (const select of await groups.getByRole("combobox").all())
    await select.selectOption({ index: 1 });
  await groups
    .getByLabel(/Reason for changing membership/)
    .fill("Join current group");
  await groups.getByRole("button", { name: "Preview changes" }).click();
  await groups.getByRole("button", { name: "Confirm assignment" }).click();
  const contribution = peer.getByRole("group", {
    name: "Your contribution: Explanation 1",
    exact: true,
  });
  await contribution
    .getByLabel("Contribution text")
    .fill("Synthetic contribution from Ben");
  await contribution.getByRole("button", { name: "Save contribution" }).focus();
  await peer.keyboard.press("Enter");
  await expect(contribution.getByRole("status")).toContainText(
    "Saved revision 1"
  );
  await x.guest
    .getByRole("button", { name: "Use contribution in Explanation 1" })
    .click();
  await x.guest
    .getByLabel("Decision — group answer", { exact: true })
    .fill("Proceed together");
  await x.guest
    .getByRole("button", { name: "Save group answer", exact: true })
    .click();
  await expect(x.guest.getByText(/Saved revision 1 at/)).toBeVisible();
  await x.guest
    .getByRole("button", { name: "Preview group submission", exact: true })
    .focus();
  await x.guest.keyboard.press("Enter");
  await expect(
    x.guest.getByRole("heading", { name: "Preview submit", exact: true })
  ).toBeFocused();
  await expect(
    x.guest.getByRole("group", { name: "Confirm group work change" })
  ).toContainText("Synthetic Ben");
  await x.guest
    .getByRole("button", { name: "Confirm group work change" })
    .click();
  await expect(
    peer.getByText("Attempt 1 · Submitted complete", { exact: true })
  ).toBeVisible();
  const originalEditor = x.guest
    .getByRole("region", { name: /^Group work Work 1 / })
    .first();
  await originalEditor
    .getByLabel("Explanation 1 — group answer", { exact: true })
    .fill("Unsaved former-recorder text");
  await originalEditor
    .getByRole("group", {
      name: "Your contribution: Explanation 1",
      exact: true,
    })
    .getByLabel("Contribution text")
    .fill("Unsaved contribution stays in this group");

  const recorder = page.getByRole("group", {
    name: "Recorder for Group 1",
    exact: true,
  });
  const ben = await recorder
    .getByRole("option")
    .filter({ hasText: "Synthetic Ben" })
    .getAttribute("value");
  await recorder.getByLabel("Choose recorder").selectOption(ben!);
  await recorder
    .getByLabel("Recorder change reason")
    .fill("Continue with Ben as recorder");
  await recorder
    .getByRole("button", { name: "Preview recorder change" })
    .click();
  await recorder
    .getByRole("button", { name: "Confirm recorder change" })
    .click();
  await expect(
    peer.getByLabel("Explanation 1 — group answer", { exact: true })
  ).toHaveValue("Synthetic contribution from Ben");
  await expect(
    x.guest.getByRole("button", { name: "Save group answer", exact: true })
  ).not.toBeVisible();
  await expect(
    originalEditor.getByLabel("Explanation 1 — group answer", { exact: true })
  ).toHaveValue("Unsaved former-recorder text");
  await expect(
    originalEditor.getByLabel("Explanation 1 — group answer", { exact: true })
  ).not.toBeEditable();
  await peer
    .getByLabel("Explanation 1 — group answer", { exact: true })
    .fill("Ben refined the shared answer");
  await peer
    .getByRole("button", { name: "Save group answer", exact: true })
    .click();
  await expect(peer.getByText(/Saved revision 2 at/)).toBeVisible();
  await peer
    .getByLabel("Reason for replacement, correction or incomplete submission")
    .fill("Refined explanation");
  await peer
    .getByRole("button", { name: "Preview group submission", exact: true })
    .click();
  await peer.getByRole("button", { name: "Confirm group work change" }).click();
  await expect(
    peer.getByText("Attempt 2 · Submitted complete", { exact: true })
  ).toBeVisible();
  await peer
    .getByText("Attempt 1 · Submitted complete", { exact: true })
    .click();
  await expect(
    peer.getByRole("region", { name: /Submitted group snapshots/ })
  ).toContainText("Synthetic contribution from Ben");
  await expectAccessible(peer);
  await expectAccessible(page);

  await groups.getByRole("button", { name: "Edit group assignment" }).click();
  await groups.getByRole("button", { name: "Add group", exact: true }).click();
  const adaSelect = groups.getByLabel(/Synthetic Ada/);
  await adaSelect.selectOption({ index: 2 });
  await groups
    .getByLabel(/Reason for changing membership/)
    .fill("Move Ada to a new group");
  await groups.getByRole("button", { name: "Preview changes" }).click();
  await groups.getByRole("button", { name: "Confirm assignment" }).click();
  await expect(
    x.guest.getByRole("region", { name: "Your group", exact: true })
  ).toContainText("Group 2");
  await expect(
    x.guest.getByText("Ben refined the shared answer", { exact: true })
  ).not.toBeVisible();
  await expect(
    x.guest.getByText("Attempt 2 · Submitted complete", { exact: true })
  ).toBeVisible();
  await expect(
    originalEditor.getByLabel("Explanation 1 — group answer", { exact: true })
  ).toHaveValue("Unsaved former-recorder text");
  const departedSlot = originalEditor
    .getByRole("group", {
      name: "Your contribution: Explanation 1",
      exact: true,
    })
    .getByLabel("Contribution text");
  await expect(departedSlot).toHaveValue(
    "Unsaved contribution stays in this group"
  );
  await expect(departedSlot).not.toBeEditable();
  await departedSlot.focus();
  await x.guest.keyboard.press("Control+A");
  await expect(departedSlot).toBeFocused();
  expect(
    await departedSlot.evaluate(
      (field: HTMLTextAreaElement) => field.selectionEnd - field.selectionStart
    )
  ).toBe("Unsaved contribution stays in this group".length);
  await expect(
    x.guest
      .getByRole("region", { name: /^Group work Work 1 / })
      .last()
      .getByRole("group", {
        name: "Your contribution: Explanation 1",
        exact: true,
      })
      .getByLabel("Contribution text")
  ).toHaveValue("");
  // The next preview must observe the assignment committed by the other panel.
  await page.reload();
  await page.getByRole("button", { name: "Preview next activity" }).click();
  let releaseAdvance!: () => void;
  const advanceGate = new Promise<void>((resolve) => {
    releaseAdvance = resolve;
  });
  let advanceHeld = false;
  await page.route("**/sessions/**", async (route) => {
    if (
      route.request().method() === "POST" &&
      route.request().postData()?.includes('"next"')
    ) {
      advanceHeld = true;
      await advanceGate;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Confirm next activity" }).click();
  try {
    await expect.poll(() => advanceHeld).toBe(true);
    const nextRecorder = page.getByRole("group", {
      name: "Recorder for Group 2",
      exact: true,
    });
    await nextRecorder.getByLabel("Choose recorder").selectOption({ index: 1 });
    await nextRecorder
      .getByLabel("Recorder change reason")
      .fill("Appoint the moved member while advance is in flight");
    await nextRecorder
      .getByRole("button", { name: "Preview recorder change" })
      .click();
    await nextRecorder
      .getByRole("button", { name: "Confirm recorder change" })
      .click();
    await expect(
      nextRecorder.getByRole("button", { name: "Confirm recorder change" })
    ).not.toBeVisible();
  } finally {
    releaseAdvance();
  }
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "The session changed in another tab" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Preview activity change" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm next activity" })
  ).toBeDisabled();
  await page.unroute("**/sessions/**");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Preview next activity" }).click();
  await page.getByRole("button", { name: "Confirm next activity" }).click();
  await x.guest
    .getByLabel("Explanation 2", { exact: true })
    .fill("Ada private individual answer");
  await x.guest
    .getByRole("button", { name: "Save draft", exact: true })
    .click();
  await expect(peer.getByLabel("Explanation 2", { exact: true })).toHaveValue(
    ""
  );
  await expect(peer.locator("main")).not.toContainText(
    "Ada private individual answer"
  );
  expect(errors).toEqual([]);
  expect(guestErrors).toEqual([]);
  await peers.close();
  await x.context.close();
});

test("AC5/11/15: pending typing, exact unknown retry, conflict and one navigation warning preserve text", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const x = await prepareWork(page, browser, { group: true });
  const answer = x.guest.getByLabel("Explanation 1 — group answer", {
    exact: true,
  });
  await answer.fill("First committed answer");
  await x.guest
    .getByLabel("Decision — group answer", { exact: true })
    .fill("Decision");
  let release!: () => void,
    committed = false;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await x.guest.route("**/api/group-work", async (route) => {
    if (route.request().postDataJSON().request?.command === "answer") {
      const response = await route.fetch();
      committed = true;
      await held;
      await route.fulfill({ response });
    } else await route.continue();
  });
  await x.guest
    .getByRole("button", { name: "Save group answer", exact: true })
    .click();
  try {
    await expect.poll(() => committed).toBe(true);
    await answer.fill("Typed while saving");
    await expect(answer).toBeFocused();
    await x.guest.waitForTimeout(1400);
    await expect(answer).toHaveValue("Typed while saving");
  } finally {
    release();
  }
  await expect(
    x.guest.getByRole("button", { name: "Save group answer", exact: true })
  ).toBeEnabled();
  await x.guest.unroute("**/api/group-work");
  let dropped = false;
  const operations: unknown[] = [];
  await x.guest.route("**/api/group-work", async (route) => {
    const body = route.request().postDataJSON();
    if (body.request?.command === "answer") {
      operations.push(body);
      if (!dropped) {
        dropped = true;
        await route.fetch();
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ error: "unavailable", uncertain: true }),
        });
        return;
      }
    }
    await route.continue();
  });
  await x.guest
    .getByRole("button", { name: "Save group answer", exact: true })
    .click();
  await expect(x.guest.getByText(/Result unknown/)).toBeVisible();
  await expect(
    x.guest.getByRole("button", {
      name: "Preview group submission",
      exact: true,
    })
  ).toBeDisabled();
  await answer.fill("Unsaved beyond the unknown save");
  await x.guest
    .getByRole("button", { name: "Retry exact group request" })
    .focus();
  await x.guest.keyboard.press("Enter");
  await expect(
    x.guest.getByRole("button", { name: "Retry exact group request" })
  ).not.toBeVisible();
  expect(operations).toHaveLength(2);
  expect(operations[1]).toEqual(operations[0]);
  await expect(answer).toHaveValue("Unsaved beyond the unknown save");
  await x.guest.unroute("**/api/group-work");
  await x.context.setOffline(true);
  await expect(
    x.guest
      .getByRole("region", { name: "Group work", exact: true })
      .getByRole("alert")
  ).toContainText("Service unavailable");
  await expect(answer).toHaveValue("Unsaved beyond the unknown save");
  await x.context.setOffline(false);
  await expect(answer).toBeEditable();
  const other = await x.context.newPage();
  await other.goto(x.guest.url());
  await other
    .getByLabel("Explanation 1 — group answer", { exact: true })
    .fill("Other tab wins");
  await other
    .getByRole("button", { name: "Save group answer", exact: true })
    .click();
  await expect(
    x.guest.getByText("Conflict — compare before saving", { exact: true })
  ).toBeVisible();
  await expect(answer).toHaveValue("Unsaved beyond the unknown save");
  await x.guest
    .getByRole("button", { name: "Keep my answer against current revision" })
    .click();
  let warnings = 0;
  x.guest.on("dialog", async (d) => {
    warnings++;
    await d.dismiss();
  });
  await x.guest.goBack();
  await expect(answer).toHaveValue("Unsaved beyond the unknown save");
  expect(warnings).toBe(1);
  await expectAccessible(x.guest);
  await x.guest
    .getByRole("button", { name: "Save group answer", exact: true })
    .click();
  await expect(x.guest.getByText(/Saved revision 4 at/)).toBeVisible();
  await x.guest
    .getByRole("button", { name: "Preview group submission", exact: true })
    .click();
  await answer.fill("Changed after preview");
  await expect(
    x.guest.getByRole("button", { name: "Confirm group work change" })
  ).toBeDisabled();
  await answer.fill("Unsaved beyond the unknown save");
  const ownSlot = x.guest.getByRole("group", {
    name: "Your contribution: Explanation 1",
    exact: true,
  });
  await ownSlot
    .getByLabel("Contribution text")
    .fill("Still unsaved on this device");
  await x.guest
    .getByRole("button", { name: "Confirm group work change" })
    .click();
  await expect(
    x.guest
      .getByRole("alert")
      .filter({ hasText: "Save or reconcile your local contribution" })
  ).toBeVisible();
  await expect(
    x.guest.getByText("Attempt 1 · Submitted complete", { exact: true })
  ).not.toBeVisible();
  await x.guest
    .getByRole("button", { name: "Cancel group work preview" })
    .click();
  await other.close();
  await x.context.close();
});
