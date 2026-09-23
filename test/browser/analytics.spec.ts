import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

type Sent = { type: string; payload: Record<string, unknown> };

const stub = readFile("test/fixture/umami-stub.js", "utf8");

/**
 * Serve the stub tracker and record what reaches the collector. Playwright's browser reports
 * `navigator.webdriver`, which the module treats as automation, so tests that expect collection
 * hide it the way an ordinary browser would.
 */
async function collector(page: Page, { human = true } = {}) {
  const sent: Sent[] = [];
  const requested: string[] = [];
  if (human) {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false });
    });
  }
  await page.route("https://stats.example.test/**", async (route) => {
    const url = new URL(route.request().url());
    requested.push(url.pathname);
    if (url.pathname === "/script.js") {
      await route.fulfill({ contentType: "text/javascript", body: await stub });
    } else {
      sent.push(route.request().postDataJSON() as Sent);
      await route.fulfill({ json: {} });
    }
  });
  return { sent, requested };
}

const events = (sent: Sent[]) =>
  sent.filter((s) => s.payload.name).map((s) => [s.payload.name, s.payload.data]);

test("loads Umami with privacy settings and sends a sanitized page view", async ({ page }) => {
  const { sent } = await collector(page);
  await page.goto("/?q=secret&utm_source=newsletter#section", {
    referer: "https://news.example/item?id=42#top",
  });
  await expect.poll(() => sent.length).toBe(1);
  expect(
    await page.evaluate(() => (window as { umamiStubAttributes?: object }).umamiStubAttributes),
  ).toMatchObject({
    "data-website-id": "00000000-0000-4000-8000-000000000000",
    "data-host-url": "https://stats.example.test",
    "data-domains": "127.0.0.1",
    "data-do-not-track": "true",
    "data-exclude-hash": "true",
    "data-performance": "true",
  });
  const [view] = sent;
  expect(view.payload.url).toBe("http://127.0.0.1:4175/?utm_source=newsletter");
  expect(view.payload.referrer).toBe("https://news.example/item");
  expect(view.payload).not.toHaveProperty("id");
});

test("a same-site referrer keeps Umami's relative shape without its query", async ({ page }) => {
  const { sent } = await collector(page);
  await page.goto("/?from=home", { referer: "http://127.0.0.1:4175/privacy/?tab=2#x" });
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].payload.referrer).toBe("/privacy/");
  expect(sent[0].payload.url).toBe("http://127.0.0.1:4175/");
});

test("records outbound, download, contact, and declared clicks without link text", async ({
  page,
}) => {
  const { sent } = await collector(page);
  await page.goto("/");
  await expect.poll(() => sent.length).toBe(1);
  for (const id of ["outbound", "download", "download-attr", "email", "internal", "declared"]) {
    await page.click(`#${id}`);
  }
  await page.click("#outbound", { button: "middle" });
  await expect.poll(() => events(sent).length).toBe(6);
  expect(events(sent)).toEqual([
    ["outbound-click", { url: "https://example.org/path" }],
    ["download-click", { format: "pdf", file: "resume.pdf" }],
    ["download-click", { format: "file", file: "export" }],
    ["contact-click", { method: "email" }],
    ["theme-toggle", { theme: "dark" }],
    ["outbound-click", { url: "https://example.org/path" }],
  ]);
});

test("records each scroll depth once and engaged time when the page is left", async ({ page }) => {
  const { sent } = await collector(page);
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto("/");
  await expect.poll(() => sent.length).toBe(1);
  for (const y of [1000, 2000, 5000, 5000]) {
    await page.evaluate((top) => scrollTo(0, top), y);
    await page.waitForTimeout(100);
  }
  await expect.poll(() => events(sent).length).toBe(4);
  expect(events(sent).map(([, data]) => data)).toEqual([
    { depth: 25 },
    { depth: 50 },
    { depth: 75 },
    { depth: 100 },
  ]);
  await page.waitForTimeout(1100);
  await page.evaluate(() => {
    dispatchEvent(new Event("pagehide"));
    dispatchEvent(new Event("pagehide"));
  });
  await expect.poll(() => events(sent).length).toBe(5);
  const [name, data] = events(sent)[4];
  expect(name).toBe("engaged-time");
  expect((data as { seconds: number }).seconds).toBeGreaterThanOrEqual(1);
});

test("never sends identify calls", async ({ page }) => {
  const { sent } = await collector(page);
  await page.goto("/");
  await expect.poll(() => sent.length).toBe(1);
  await page.evaluate(() =>
    (window as unknown as { umami: { identify(id: string): Promise<void> } }).umami.identify(
      "someone",
    ),
  );
  await page.waitForTimeout(200);
  expect(sent.map((s) => s.type)).toEqual(["event"]);
});

const blockers: [string, (page: Page) => Promise<unknown>][] = [
  [
    "Global Privacy Control",
    (page) =>
      page.addInitScript(() =>
        Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true }),
      ),
  ],
  [
    "Do Not Track",
    (page) =>
      page.addInitScript(() =>
        Object.defineProperty(Navigator.prototype, "doNotTrack", { get: () => "1" }),
      ),
  ],
  [
    "the opt-out flag",
    (page) => page.addInitScript(() => localStorage.setItem("umami.disabled", "1")),
  ],
];

for (const [name, block] of blockers) {
  test(`does not load the tracker with ${name}`, async ({ page }) => {
    const { requested } = await collector(page);
    await block(page);
    await page.goto("/");
    await page.waitForTimeout(300);
    expect(requested).toEqual([]);
  });
}

test("does not load the tracker for automation or another hostname", async ({ page }) => {
  const automated = await collector(page, { human: false });
  await page.goto("/");
  await page.waitForTimeout(300);
  expect(automated.requested).toEqual([]);

  const { requested } = await collector(page);
  await page.goto("http://localhost:4175/");
  await page.waitForTimeout(300);
  expect(requested).toEqual([]);
});

test("the privacy page opt-out toggles counting for this site", async ({ page }) => {
  await collector(page);
  await page.goto("/privacy/");
  const status = page.getByRole("status");
  const button = page.getByRole("button", { name: "Stop counting my visits" });
  await expect(status).toHaveText("This site counts your visits in this browser.");
  await button.click();
  await expect(status).toHaveText("This site does not count your visits in this browser.");
  expect(await page.evaluate(() => localStorage.getItem("umami.disabled"))).toBe("1");
  await page.getByRole("button", { name: "Resume counting my visits" }).click();
  expect(await page.evaluate(() => localStorage.getItem("umami.disabled"))).toBeNull();
});

test("the opt-out reports a browser privacy signal and hides without scripts", async ({
  page,
  browser,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true }),
  );
  await page.goto("/privacy/");
  await expect(page.getByRole("status")).toHaveText(
    "Your browser sends Global Privacy Control, so this site does not count your visits.",
  );
  const context = await browser.newContext({ javaScriptEnabled: false });
  const noScript = await context.newPage();
  await noScript.goto("http://127.0.0.1:4175/privacy/");
  await expect(noScript.getByRole("button")).toBeHidden();
  await expect(noScript.getByText("With JavaScript off, nothing is collected")).toBeVisible();
  await context.close();
});
