import { EventEmitter } from "node:events";
import type { Page } from "@playwright/test";
import { expect, test } from "vitest";
import { collectErrors } from "../support/browser";

const offline = "net::ERR_INTERNET_DISCONNECTED";
const networkFailure = (page: EventEmitter, error: string) => {
  page.emit("requestfailed", {
    failure: () => ({ errorText: error }),
    url: () => "/api/work",
  });
  page.emit("console", {
    type: () => "error",
    text: () => `Failed to load resource: ${error}`,
  });
};

test("network failures are unexpected unless the scenario explicitly allows them", () => {
  const page = new EventEmitter();
  const errors = collectErrors(page as unknown as Page);
  networkFailure(page, offline);
  expect(errors).toEqual(["/api/work", `Failed to load resource: ${offline}`]);
});

test("an expected offline fault does not suppress other transport or application errors", () => {
  const page = new EventEmitter();
  const errors = collectErrors(page as unknown as Page, offline);
  networkFailure(page, offline);
  networkFailure(page, "net::ERR_CONNECTION_RESET");
  page.emit("pageerror", new Error(offline));
  page.emit("console", {
    type: () => "error",
    text: () => "Application failed",
  });
  expect(errors).toEqual([
    "/api/work",
    "Failed to load resource: net::ERR_CONNECTION_RESET",
    offline,
    "Application failed",
  ]);
});
