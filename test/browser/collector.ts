import { test as base, expect, type Page } from "@playwright/test";
import { problems } from "./umami-server.ts";

export type Sent = { type: string; payload: Record<string, unknown> };
type Options = { human?: boolean; delay?: number; fail?: boolean };
type Collector = { sent: Sent[]; requested: string[] };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type, x-umami-cache, x-umami-website-id, x-umami-hostname",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

/**
 * Serve Umami 3.4.0's real tracker as the collector's script.js and record what reaches
 * /api/send. Playwright's browser reports `navigator.webdriver`, which the module treats as
 * automation, so tests that expect collection hide it the way an ordinary browser would.
 */
async function collect(
  page: Page,
  { human = true, delay = 0, fail = false }: Options = {},
): Promise<Collector> {
  const sent: Sent[] = [];
  const requested: string[] = [];
  if (human) {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false });
    });
  }
  const tracker = await (await page.request.get("/umami.js")).text();
  await page.route("https://stats.example.test/**", async (route) => {
    const url = new URL(route.request().url());
    requested.push(url.pathname);
    if (fail) return route.abort();
    if (url.pathname === "/script.js") {
      return route.fulfill({ contentType: "text/javascript", body: tracker });
    }
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ headers: corsHeaders });
    }
    sent.push(route.request().postDataJSON() as Sent);
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    return route.fulfill({ json: {}, headers: corsHeaders });
  });
  return { sent, requested };
}

/**
 * `collector()` routes the test's page to a fake collector. After each test, every recorded
 * request must be one Umami 3.4.0 accepts and this package's contract allows.
 */
export const test = base.extend<{ collector: (options?: Options) => Promise<Collector> }>({
  collector: async ({ page }, use) => {
    const all: Sent[][] = [];
    await use(async (options) => {
      const collector = await collect(page, options);
      all.push(collector.sent);
      return collector;
    });
    for (const sent of all.flat()) expect(problems(sent), JSON.stringify(sent)).toEqual([]);
  },
});

export { expect };

export const events = (sent: Sent[]) =>
  sent.filter((s) => s.payload.name).map((s) => [s.payload.name, s.payload.data]);
export const pageviews = (sent: Sent[]) =>
  sent.filter((s) => s.type === "event" && !s.payload.name);
export const state = (page: Page) => page.locator("#site-analytics").getAttribute("data-state");

export async function loaded(sent: Sent[]) {
  await expect.poll(() => pageviews(sent).length).toBe(1);
}

/** Pretend the tab was hidden or shown; the module and Umami both read `visibilityState`. */
export async function setVisibility(page: Page, visibility: "visible" | "hidden") {
  await page.evaluate((value) => {
    Object.defineProperty(document, "visibilityState", { value, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  }, visibility);
}
