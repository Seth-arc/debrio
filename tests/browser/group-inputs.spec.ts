import { expect, test } from "@playwright/test";
import { prepareWork } from "../support/work-browser";
import { collectErrors, expectAccessible } from "../support/browser";

test("group fixed input stays on consumed version; late members need exact grants and held old-group reads cannot return", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const x = await prepareWork(page, browser, { group: true, linked: true });
  const source = x.guest.getByRole("region", { name: /^Group work Work 1 / });
  await source
    .getByLabel("Explanation 1 — group answer", { exact: true })
    .fill("Synthetic group source version one");
  await source
    .getByLabel("Decision — group answer", { exact: true })
    .fill("Unrelated private source field");
  await source
    .getByRole("button", { name: "Save group answer", exact: true })
    .click();
  await expect(source.getByText(/Saved revision 1 at/)).toBeVisible();
  await source
    .getByRole("button", { name: "Preview group submission", exact: true })
    .click();
  await source
    .getByRole("button", { name: "Confirm group work change" })
    .click();
  const execution = page.getByRole("region", { name: "Session activities" });
  await expect(execution).toContainText("Fixed input readiness: ready.");
  await execution
    .getByRole("button", { name: "Preview next activity" })
    .click();
  await expect(
    execution.getByRole("group", { name: "Confirm activity change" })
  ).toContainText("Synthetic group source version one");
  await execution
    .getByRole("button", { name: "Confirm next activity" })
    .click();
  const adaInput = x.guest.getByRole("region", {
    name: "Fixed prior-output inputs",
  });
  await expect(adaInput.locator("[data-input-value]")).toHaveText(
    "Synthetic group source version one"
  );
  const hostSource = page.getByRole("region", { name: /^Group work Work 1 / });
  await hostSource
    .getByLabel("Reason for replacement, correction or incomplete submission")
    .fill("Correct the source without changing consumed inputs");
  await hostSource
    .getByRole("group", { name: "Named correction audience" })
    .getByRole("checkbox")
    .check();
  await hostSource
    .getByRole("button", { name: "Preview reopening corrections" })
    .click();
  await hostSource
    .getByRole("button", { name: "Confirm group work change" })
    .click();
  await expect(
    source.getByLabel("Explanation 1 — group answer", { exact: true })
  ).toBeEditable();
  await source
    .getByLabel("Explanation 1 — group answer", { exact: true })
    .fill("Synthetic corrected source version two");
  await source
    .getByRole("button", { name: "Save group answer", exact: true })
    .click();
  await expect(source.getByText(/Saved revision 2 at/)).toBeVisible();
  await source
    .getByLabel("Reason for replacement, correction or incomplete submission")
    .fill("Synthetic correction after consumption");
  await source
    .getByRole("button", { name: "Preview group submission", exact: true })
    .click();
  await source
    .getByRole("button", { name: "Confirm group work change" })
    .click();
  await expect(adaInput.locator("[data-input-value]")).toHaveText(
    "Synthetic group source version one"
  );
  const peers = await browser.newContext({
    viewport: page.viewportSize(),
    ...(process.env.INPUT_DEMO
      ? {
          recordVideo: {
            dir: ".artifacts/P2-03c/raw",
            size: { width: 1280, height: 720 },
          },
        }
      : {}),
  });
  const peer = await peers.newPage();
  const errors = collectErrors(peer);
  await peer.goto(
    await page.getByLabel("Share this link with participants").inputValue()
  );
  await peer.getByLabel("Your name").fill("Synthetic Ben");
  await peer.getByLabel("Your name").press("Enter");
  await page.getByRole("button", { name: "Admit Synthetic Ben" }).click();
  await expect(peer.getByRole("heading", { name: "You're in" })).toBeVisible();
  const groups = page.getByRole("region", {
    name: "Session groups",
    exact: true,
  });
  await expect(groups).toContainText("2 admitted people.");
  const assign = async (inGroup: boolean) => {
    await groups.getByRole("button", { name: "Edit group assignment" }).click();
    await groups
      .getByLabel(/^Synthetic Ben/)
      .selectOption({ index: inGroup ? 1 : 0 });
    await groups
      .getByLabel(/Reason for changing membership/)
      .fill(
        inGroup
          ? "Include late member in current group"
          : "End this membership interval"
      );
    await groups.getByRole("button", { name: "Preview changes" }).click();
    await groups.getByRole("button", { name: "Confirm assignment" }).click();
    await expect(
      groups.getByRole("button", { name: "Confirm assignment" })
    ).toHaveCount(0);
  };
  await assign(true);
  const input = peer.getByRole("region", { name: "Fixed prior-output inputs" });
  await expect(input).toContainText("Input access needs host confirmation");
  await expect(input.locator("[data-input-value]")).toHaveCount(0);
  await expect(peer.locator("main")).not.toContainText(
    "Unrelated private source field"
  );
  await expect(peer.locator("main")).not.toContainText(
    "Synthetic corrected source version two"
  );
  const hostInput = page.getByRole("region", {
    name: "Fixed prior-output inputs",
  });
  await hostInput.getByRole("button", { name: "Resolve input access" }).click();
  const confirm = hostInput.getByRole("group", {
    name: "Confirm input access",
  });
  await expect(confirm).toContainText("Synthetic Ben");
  await expect(confirm).toContainText("Synthetic group source version one");
  await expect(confirm).not.toContainText(
    "Synthetic corrected source version two"
  );
  await hostInput
    .getByLabel("Reason for input access change")
    .fill("Grant the fixed field to the named late member");
  await hostInput
    .getByRole("button", { name: "Confirm input access change" })
    .click();
  await expect(input.locator("[data-input-value]")).toHaveText(
    "Synthetic group source version one"
  );
  const contribution = peer.getByRole("group", {
    name: "Your contribution: Explanation 2",
    exact: true,
  });
  await contribution
    .getByLabel("Contribution text")
    .fill("Own work retained across input access loss");
  await contribution.getByRole("button", { name: "Save contribution" }).click();
  await expect(contribution.getByRole("status")).toContainText(
    "Saved revision 1"
  );
  let held = false;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await peer.route("**/api/inputs", async (route) => {
    if (!held) {
      const response = await route.fetch();
      expect((await response.json()).snapshot.items).toHaveLength(1);
      held = true;
      await waiting;
      await route.fulfill({ response });
    } else await route.continue();
  });
  try {
    await expect.poll(() => held).toBe(true);
    await assign(false);
    await expect(
      peer.getByRole("region", { name: "Your group" })
    ).toContainText("Unassigned");
    await expect(input.locator("[data-input-value]")).toHaveCount(0);
  } finally {
    release();
  }
  await peer.unrouteAll({ behavior: "wait" });
  await peer.waitForTimeout(1000);
  await expect(input.locator("[data-input-value]")).toHaveCount(0);
  await assign(true);
  await expect(input.locator("[data-input-value]")).toHaveCount(0);
  await hostInput.getByRole("button", { name: "Resolve input access" }).click();
  await hostInput
    .getByLabel("Reason for input access change")
    .fill("Confirm the new continuous membership interval");
  await hostInput
    .getByRole("button", { name: "Confirm input access change" })
    .click();
  await expect(input.locator("[data-input-value]")).toHaveText(
    "Synthetic group source version one"
  );
  await peer.reload();
  await expect(contribution.getByLabel("Contribution text")).toHaveValue(
    "Own work retained across input access loss"
  );
  await contribution
    .getByLabel("Contribution text")
    .fill("Unsaved old-device text stays here");
  let oldRead = false;
  let releaseOld!: () => void;
  const oldReply = new Promise<void>((resolve) => {
    releaseOld = resolve;
  });
  await peer.route("**/api/inputs", async (route) => {
    if (!oldRead) {
      const response = await route.fetch();
      expect((await response.json()).snapshot.items).toHaveLength(1);
      oldRead = true;
      await oldReply;
      await route.fulfill({ response });
    } else await route.continue();
  });
  const recoveredContext = await browser.newContext({
    viewport: page.viewportSize(),
  });
  const recovered = await recoveredContext.newPage();
  try {
    await expect.poll(() => oldRead).toBe(true);
    await recovered.goto(
      await page.getByLabel("Share this link with participants").inputValue()
    );
    await recovered.getByLabel("Your name").fill("Synthetic Ben recovered");
    await recovered.getByLabel("I was already in this session").check();
    await recovered.getByLabel("Your name").press("Enter");
    const restore = page.getByLabel("Restore Synthetic Ben recovered as");
    const target = await restore
      .locator("option")
      .filter({ hasText: "Synthetic Ben" })
      .getAttribute("value");
    await restore.selectOption(target!);
    await page.getByRole("button", { name: "Restore", exact: true }).click();
    await expect(
      recovered.getByRole("heading", { name: "You're in" })
    ).toBeVisible();
    await expect(input.locator("[data-input-value]")).toHaveCount(0);
  } finally {
    releaseOld();
  }
  await peer.unrouteAll({ behavior: "wait" });
  await expect(input.locator("[data-input-value]")).toHaveCount(0);
  await expect(contribution.getByLabel("Contribution text")).toHaveValue(
    "Unsaved old-device text stays here"
  );
  await expect(
    recovered
      .getByRole("region", { name: "Fixed prior-output inputs" })
      .locator("[data-input-value]")
  ).toHaveText("Synthetic group source version one");
  await expect(
    recovered
      .getByRole("group", {
        name: "Your contribution: Explanation 2",
        exact: true,
      })
      .getByLabel("Contribution text")
  ).toHaveValue("Own work retained across input access loss");
  await expectAccessible(recovered);
  await expectAccessible(peer);
  expect(errors).toEqual([]);
  await peers.close();
  await recoveredContext.close();
  await x.context.close();
});
