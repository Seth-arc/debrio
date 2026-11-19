import { expect, test } from "vitest";
import { emailChangeStatus, emailNotice, otherNotice } from "../../app/notices";

const status = (query: string) => emailChangeStatus(new URLSearchParams(query));

test("email-change links map to a fixed status", () => {
  expect(status("flow=email&code=abc")).toBe("changed");
  expect(status("flow=email&message=Confirmation+link+accepted")).toBe(
    "one-confirmed"
  );
  expect(status("flow=email&error=access_denied&code=abc")).toBe("failed");
  expect(status("flow=email")).toBe("failed");
});

test("only allow-listed statuses produce a notice, worded for what can be checked", () => {
  expect(emailNotice("changed", "signed-in")).toBe(
    "Your email address has changed."
  );
  expect(emailNotice("changed", "signed-out")).toContain(
    "If you've opened both links"
  );
  expect(emailNotice("<script>", "signed-in")).toBeUndefined();
  expect(emailNotice("constructor", "signed-out")).toBeUndefined();
  expect(otherNotice("recheck")).toContain("Nothing was changed");
  expect(otherNotice("toString")).toBeUndefined();
});
