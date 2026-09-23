import { expect, type Page, test } from "@playwright/test";

type Sent = { type: string; payload: Record<string, unknown> };

/**
 * Serve Umami 3.4.0's real tracker as the collector's script.js and record what reaches
 * /api/send. Playwright's browser reports `navigator.webdriver`, which the module treats as
 * automation, so tests that expect collection hide it the way an ordinary browser would.
 */
async function collector(page: Page, { human = true, delay = 0, fail = false } = {}) {
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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type, x-umami-cache, x-umami-website-id, x-umami-hostname",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const events = (sent: Sent[]) =>
  sent.filter((s) => s.payload.name).map((s) => [s.payload.name, s.payload.data]);
const pageviews = (sent: Sent[]) => sent.filter((s) => s.type === "event" && !s.payload.name);
const state = (page: Page) => page.locator("#site-analytics").getAttribute("data-state");

async function loaded(sent: Sent[]) {
  await expect.poll(() => pageviews(sent).length).toBe(1);
}

test("sends a page view with only standard campaign tags and no fragment or identifiers", async ({
  page,
}) => {
  const { sent } = await collector(page);
  await page.goto(
    "/?q=secret&utm_source=newsletter&utm_email=bob%40example.com&utm_content=alice%40example.com#s",
    { referer: "https://news.example/item?id=42#top" },
  );
  await loaded(sent);
  const [view] = pageviews(sent);
  expect(view.payload.url).toBe("https://127.0.0.1:4175/?utm_source=newsletter");
  expect(view.payload.referrer).toBe("https://news.example/item");
  expect(view.payload).not.toHaveProperty("id");
  expect(await state(page)).toBe("loaded");
});

test("redacts email addresses in page paths and titles", async ({ page }) => {
  const { sent } = await collector(page);
  await page.goto("/people/alice@example.com/");
  await loaded(sent);
  const [view] = pageviews(sent);
  expect(view.payload.url).toBe("https://127.0.0.1:4175/people/[email]/");
  expect(view.payload.title).toBe("Alice [email]");
});

test("redacts only path segments holding an address and keeps other encodings", async ({
  page,
}) => {
  const { sent } = await collector(page);
  await page.goto("/");
  await loaded(sent);
  await page.evaluate(() =>
    history.pushState({}, "", "/package/react@18.2.0/a%2Fb/100%25off/al%2540ex.com/x"),
  );
  await expect.poll(() => pageviews(sent).length).toBe(2);
  expect(pageviews(sent)[1].payload.url).toBe(
    "https://127.0.0.1:4175/package/react@18.2.0/a%2Fb/100%25off/[email]/x",
  );
});

test("sends only Umami's own payload fields, with event data redacted", async ({ page }) => {
  const { sent } = await collector(page);
  await page.goto("/");
  await loaded(sent);
  await page.evaluate(() => {
    const umami = (window as unknown as { umami: { track(p: object): Promise<void> } }).umami;
    return umami.track({
      website: "00000000-0000-4000-8000-000000000000",
      url: "/x",
      data: { email: "bob@example.com", n: 1 },
      extra: "carol@example.com",
    });
  });
  await expect.poll(() => pageviews(sent).length).toBe(2);
  const payload = pageviews(sent)[1].payload;
  expect(payload).not.toHaveProperty("extra");
  expect(payload.data).toEqual({ email: "[email]", n: 1 });
});

test("a same-site referrer keeps Umami's relative shape without its query", async ({ page }) => {
  const { sent } = await collector(page);
  await page.goto("/", { referer: "https://127.0.0.1:4175/privacy/?tab=2#x" });
  await loaded(sent);
  expect(pageviews(sent)[0].payload.referrer).toBe("/privacy/");
});

test("records link and control clicks without link text or addresses", async ({ page }) => {
  const { sent } = await collector(page);
  await page.goto("/");
  await loaded(sent);
  for (const id of ["outbound", "readme", "download", "download-attr", "email", "internal"]) {
    await page.click(`#${id}`);
  }
  for (const id of ["declared", "leaky", "svg-link", "svg-xlink"]) await page.click(`#${id}`);
  // Image-map areas are not clickable targets for Playwright; dispatch the click it would fire.
  await page.locator("#area").dispatchEvent("click");
  await page.click("#outbound", { button: "middle" });
  await page.click("#declared", { button: "middle" });
  await expect.poll(() => events(sent).length).toBe(11);
  expect(events(sent)).toEqual([
    ["outbound-click", { url: "https://example.org/path" }],
    ["outbound-click", { url: "https://github.com/x/y/blob/main/README.md" }],
    ["download-click", { format: "pdf", file: "resume.pdf" }],
    ["download-click", { format: "file", file: "export" }],
    ["contact-click", { method: "email" }],
    ["theme-toggle", { theme: "dark" }],
    ["note", { who: "[email]" }],
    ["outbound-click", { url: "https://example.net/svg" }],
    ["outbound-click", { url: "https://example.net/xlink" }],
    ["outbound-click", { url: "https://example.com/area" }],
    ["outbound-click", { url: "https://example.org/path" }],
  ]);
});

test("drops Umami's own data-umami-event clicks without delaying navigation", async ({ page }) => {
  const { sent } = await collector(page, { delay: 3000 });
  await page.goto("/");
  await loaded(sent);
  const started = Date.now();
  await page.click("#umami-event");
  await page.waitForURL("**/other");
  expect(Date.now() - started).toBeLessThan(1500);
  expect(sent.some((s) => s.payload.name === "umami-own")).toBe(false);
});

test("counts scroll depth only after the visitor scrolls, once per depth", async ({ page }) => {
  const { sent } = await collector(page);
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto("/#end");
  await loaded(sent);
  await page.mouse.move(400, 300);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(300);
  expect(events(sent)).toEqual([]);

  await page.goto("/");
  await expect.poll(() => pageviews(sent).length).toBe(2);
  await page.mouse.move(400, 300);
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(50);
  }
  await expect.poll(() => events(sent).length).toBe(4);
  expect(events(sent).map(([, data]) => data)).toEqual([
    { depth: 25 },
    { depth: 50 },
    { depth: 75 },
    { depth: 100 },
  ]);
});

async function setVisibility(page: Page, visibility: "visible" | "hidden") {
  await page.evaluate((value) => {
    Object.defineProperty(document, "visibilityState", { value, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  }, visibility);
}

test("reports visible seconds each time the page is hidden, never hidden time", async ({
  page,
}) => {
  const { sent } = await collector(page);
  await page.goto("/");
  await loaded(sent);
  await page.waitForTimeout(1200);
  await setVisibility(page, "hidden");
  await page.waitForTimeout(2000);
  await setVisibility(page, "visible");
  await page.waitForTimeout(1200);
  await setVisibility(page, "hidden");
  await expect.poll(() => events(sent).length).toBe(2);
  const seconds = events(sent).map(([, data]) => (data as { seconds: number }).seconds);
  expect(seconds).toEqual([1, 1]);
});

test("loads once even when the module is included twice", async ({ page }) => {
  const { sent, requested } = await collector(page);
  await page.goto("/double");
  await loaded(sent);
  await page.waitForTimeout(500);
  expect(pageviews(sent)).toHaveLength(1);
  expect(requested.filter((path) => path === "/script.js")).toHaveLength(1);
});

test("the before-send hook cannot be replaced by page scripts", async ({ page }) => {
  const { sent } = await collector(page);
  await page.goto("/");
  await loaded(sent);
  await page.evaluate(() => {
    try {
      (window as unknown as Record<string, unknown>).siteAnalyticsBeforeSend = undefined;
    } catch {}
    history.pushState({}, "", "/other?token=abc#x");
  });
  await expect.poll(() => pageviews(sent).length).toBe(2);
  expect(pageviews(sent)[1].payload.url).toBe("https://127.0.0.1:4175/other");
});

test("never sends identify calls", async ({ page }) => {
  const { sent } = await collector(page);
  await page.goto("/");
  await loaded(sent);
  await page.evaluate(() =>
    (window as unknown as { umami: { identify(id: string): Promise<void> } }).umami.identify(
      "someone",
    ),
  );
  await page.waitForTimeout(300);
  expect(sent.map((s) => s.type)).toEqual(["event"]);
});

test("stops sending as soon as the visitor opts out", async ({ page }) => {
  const { sent } = await collector(page);
  await page.goto("/");
  await loaded(sent);
  await page.evaluate(() => localStorage.setItem("umami.disabled", "1"));
  await page.click("#outbound");
  await page.waitForTimeout(300);
  expect(events(sent)).toEqual([]);
});

test("drops events when the tracker fails to load", async ({ page }) => {
  const { sent } = await collector(page, { fail: true });
  await page.goto("/");
  await expect.poll(() => state(page)).toBe("failed");
  await page.click("#outbound");
  expect(sent).toEqual([]);
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
    await expect.poll(() => state(page)).toBe("blocked");
    expect(requested).toEqual([]);
  });
}

test("does not load the tracker for automation or another hostname", async ({ page }) => {
  const automated = await collector(page, { human: false });
  await page.goto("/");
  await expect.poll(() => state(page)).toBe("blocked");
  expect(automated.requested).toEqual([]);

  await page.goto("https://localhost:4175/");
  await expect.poll(() => state(page)).toBe("blocked");
  // The configured host has no port, so the same name on another port does not count.
  await page.goto("/without-port");
  await expect.poll(() => state(page)).toBe("blocked");
  expect(automated.requested).toEqual([]);
});

test("ignores a spoofed or invalid config", async ({ page }) => {
  const { requested } = await collector(page);
  await page.goto("/spoofed");
  await page.waitForLoadState("load");
  await page.goto("/bad-collector");
  await page.waitForLoadState("load");
  await page.waitForTimeout(300);
  expect(requested).toEqual([]);
  expect(await page.evaluate(() => "pwned" in window)).toBe(false);
  expect(await state(page)).toBeNull();
});

test("opt-out controls toggle counting and stay in sync", async ({ page }) => {
  await collector(page);
  await page.goto("/privacy/");
  const status = page.getByRole("status");
  await expect(status).toHaveText(Array(2).fill("This site counts your visits in this browser."));
  await page.getByRole("button", { name: "Stop counting my visits" }).first().click();
  await expect(status).toHaveText(
    Array(2).fill("This site does not count your visits in this browser."),
  );
  await expect(page.getByRole("button", { name: "Resume counting my visits" })).toHaveCount(2);
  expect(await page.evaluate(() => localStorage.getItem("umami.disabled"))).toBe("1");
  await page.getByRole("button", { name: "Resume counting my visits" }).last().click();
  expect(await page.evaluate(() => localStorage.getItem("umami.disabled"))).toBeNull();
});

test("the opt-out says so when a choice cannot be saved, without disabling resume", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("umami.disabled", "1");
    Storage.prototype.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
  });
  await page.goto("/privacy/");
  const resume = page.getByRole("button", { name: "Resume counting my visits" }).first();
  await expect(resume).toBeEnabled();
  await resume.click();
  expect(await page.evaluate(() => localStorage.getItem("umami.disabled"))).toBeNull();
  await page.getByRole("button", { name: "Stop counting my visits" }).first().click();
  await expect(page.getByRole("status").first()).toContainText("did not let this site save");
});

test("the opt-out explains when storage is blocked or a browser signal applies", async ({
  page,
  browser,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    }),
  );
  await page.goto("/privacy/");
  await expect(page.getByRole("status").first()).toContainText("blocks site storage");
  await expect(page.getByRole("button").first()).toBeDisabled();

  const gpc = await browser.newPage({ ignoreHTTPSErrors: true });
  await gpc.addInitScript(() =>
    Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true }),
  );
  await gpc.goto("https://127.0.0.1:4175/privacy/");
  await expect(gpc.getByRole("status").first()).toHaveText(
    "Your browser sends Global Privacy Control, so this site does not count your visits.",
  );
  await gpc.close();
});

test("the opt-out control stays hidden without scripts", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto("https://127.0.0.1:4175/privacy/");
  await expect(page.getByRole("button")).toHaveCount(0);
  await expect(page.getByText("With JavaScript off, nothing is collected")).toBeVisible();
  await context.close();
});
