import type { Page } from "@playwright/test";
import { events, expect, loaded, pageviews, setVisibility, state, test } from "./collector.ts";

test("sends a page view with only standard campaign tags and no fragment or identifiers", async ({
  page,
  collector,
}) => {
  const { sent } = await collector();
  await page.goto(
    "/?q=secret&utm_source=newsletter&utm_email=bob%40example.com&utm_content=alice%40example.com#s",
    { referer: "https://news.example/item?id=42#top" },
  );
  await loaded(sent);
  const [view] = pageviews(sent);
  expect(view.payload.url).toBe("https://127.0.0.1:4175/?utm_source=newsletter");
  // Safari's WebKit trims a cross-site referrer to its origin before any script can read it.
  expect(["https://news.example/item", "https://news.example/"]).toContain(view.payload.referrer);
  expect(view.payload).not.toHaveProperty("id");
  expect(await state(page)).toBe("loaded");
});

test("redacts email addresses in page paths and titles", async ({ page, collector }) => {
  const { sent } = await collector();
  await page.goto("/people/alice@example.com/");
  await loaded(sent);
  const [view] = pageviews(sent);
  expect(view.payload.url).toBe("https://127.0.0.1:4175/people/[email]/");
  expect(view.payload.title).toBe("Alice [email]");
});

test("redacts only path segments holding an address and keeps other encodings", async ({
  page,
  collector,
}) => {
  const { sent } = await collector();
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

test("sends only Umami's own payload fields, and no data on page views", async ({
  page,
  collector,
}) => {
  const { sent } = await collector();
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
  expect(payload).not.toHaveProperty("data");
  // The page's own address, title, and referrer, never the caller's.
  expect(payload.url).toBe("https://127.0.0.1:4175/");
  expect(payload.title).toBe("Fixture home");
  expect(payload.referrer).toBe(pageviews(sent)[0].payload.referrer);
});

type Track = { track(p: object | ((p: object) => object)): Promise<void> };

test("a page script cannot put its own values in a page view", async ({ page, collector }) => {
  const { sent } = await collector();
  await page.goto("/");
  await loaded(sent);
  await page.evaluate(async () => {
    const { umami } = window as unknown as { umami: Track };
    const spoof = {
      website: "00000000-0000-4000-8000-000000000000",
      url: "/exfil/SECRET-COOKIE-VALUE-1234567890",
      referrer: "/also/another-secret-blob-xyz",
      title: "leaked-session-token=abcdef0123456789 not-an-email-at-all",
      hostname: "SECRET-host.example",
      language: "SECRET-language",
      screen: "SECRET-screen",
      tag: "SECRET-tag",
      id: "SECRET-id",
      ttfb: 1234,
    };
    await umami.track(spoof);
    await umami.track((props) => ({ ...props, ...spoof }));
    // Another website ID is not this site's page view at all.
    await umami.track({ ...spoof, website: "11111111-1111-4111-8111-111111111111" });
  });
  await expect.poll(() => pageviews(sent).length).toBe(3);
  await page.waitForTimeout(300);
  expect(pageviews(sent)).toHaveLength(3);
  expect(JSON.stringify(sent)).not.toMatch(/SECRET|exfil|another-secret|leaked-session/);
  const [real, ...spoofed] = pageviews(sent);
  for (const view of spoofed) {
    expect(view.payload).toEqual(real.payload);
    expect(view.payload).not.toHaveProperty("ttfb");
    expect(view.payload).not.toHaveProperty("tag");
  }
});

test("history navigations report the page's own address and the previous one as referrer", async ({
  page,
  collector,
}) => {
  const { sent } = await collector();
  await page.goto("/?utm_source=a&q=1", { referer: "https://news.example/" });
  await loaded(sent);
  await page.evaluate(() => {
    document.title = "Other page";
    history.pushState({}, "", "/other?utm_medium=b&token=abc#x");
  });
  await expect.poll(() => pageviews(sent).length).toBe(2);
  await page.evaluate(() => history.pushState({}, "", "/third/"));
  await expect.poll(() => pageviews(sent).length).toBe(3);
  await page.evaluate(() =>
    (window as unknown as { umami: Track }).umami.track({
      website: "00000000-0000-4000-8000-000000000000",
      url: "/exfil",
      referrer: "/exfil-referrer",
    }),
  );
  await page.click("#outbound");
  await expect.poll(() => pageviews(sent).length).toBe(4);
  await expect.poll(() => events(sent).length).toBe(1);
  const views = pageviews(sent).map(({ payload: { url, referrer, title } }) => ({
    url,
    referrer,
    title,
  }));
  expect(views).toEqual([
    {
      url: "https://127.0.0.1:4175/?utm_source=a",
      referrer: "https://news.example/",
      title: "Fixture home",
    },
    { url: "https://127.0.0.1:4175/other?utm_medium=b", referrer: "/", title: "Other page" },
    { url: "https://127.0.0.1:4175/third/", referrer: "/other", title: "Other page" },
    // A repeated view of the same address keeps its referrer rather than referring to itself.
    { url: "https://127.0.0.1:4175/third/", referrer: "/other", title: "Other page" },
  ]);
  expect(sent.find((s) => s.payload.name)?.payload.url).toBe("https://127.0.0.1:4175/third/");
});

test("catches encoded addresses in titles, links, file names, and campaign tags", async ({
  page,
  collector,
}) => {
  const { sent } = await collector();
  await page.goto("/?utm_source=bob%2540example.com&utm_medium=email");
  await loaded(sent);
  expect(pageviews(sent)[0].payload.url).toBe("https://127.0.0.1:4175/?utm_medium=email");
  await page.evaluate(() => {
    document.title = "Contact bob%40example.com";
    for (const href of [
      "https://x.example/u/alice%40example.com/p",
      "/files/alice%40example.com.pdf",
    ]) {
      const link = Object.assign(document.createElement("a"), { href, textContent: href });
      document.body.append(link);
      link.click();
    }
    history.pushState({}, "", "/other");
  });
  await expect.poll(() => pageviews(sent).length).toBe(2);
  expect(events(sent)).toEqual([
    ["outbound-click", { url: "https://x.example/u/[email]/p" }],
    ["download-click", { format: "pdf", file: "[email]" }],
  ]);
  expect(pageviews(sent)[1].payload.title).toBe("Contact [email]");
});

test("a same-site referrer keeps Umami's relative shape without its query", async ({
  page,
  collector,
}) => {
  const { sent } = await collector();
  await page.goto("/", { referer: "https://127.0.0.1:4175/privacy/?tab=2#x" });
  await loaded(sent);
  expect(pageviews(sent)[0].payload.referrer).toBe("/privacy/");
});

test("records link and control clicks without link text or addresses", async ({
  page,
  collector,
}) => {
  const { sent } = await collector();
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
  await expect.poll(() => events(sent).length).toBe(10);
  expect(events(sent)).toEqual([
    ["outbound-click", { url: "https://example.org/path" }],
    ["outbound-click", { url: "https://github.com/x/y/blob/main/README.md" }],
    ["download-click", { format: "pdf", file: "resume.pdf" }],
    ["download-click", { format: "file", file: "export" }],
    ["contact-click", { method: "email" }],
    ["theme-toggle", { theme: "dark" }],
    ["outbound-click", { url: "https://example.net/svg" }],
    ["outbound-click", { url: "https://example.net/xlink" }],
    ["outbound-click", { url: "https://example.com/area" }],
    ["outbound-click", { url: "https://example.org/path" }],
  ]);
});

test("drops declared events outside the collection contract", async ({ page, collector }) => {
  const { sent } = await collector();
  await page.goto("/");
  await loaded(sent);
  for (const id of ["leaky", "declared-bad", "declared-extra", "declared-link", "declared"]) {
    await page.click(`#${id}`);
  }
  await expect.poll(() => events(sent).length).toBe(2);
  // An undeclared event on a link leaves the link event; the rest send nothing.
  expect(events(sent)).toEqual([
    ["outbound-click", { url: "https://example.org/x" }],
    ["theme-toggle", { theme: "dark" }],
  ]);
});

// An empty list, and a config from before the list existed, both declare nothing.
for (const path of ["/undeclared", "/unlisted"]) {
  test(`sends no declared event the site's config does not declare (${path})`, async ({
    page,
    collector,
  }) => {
    const { sent } = await collector();
    await page.goto(path);
    await loaded(sent);
    for (const id of ["declared", "declared-link", "outbound"]) await page.click(`#${id}`);
    await expect.poll(() => events(sent).length).toBe(2);
    // The declared control sends nothing; a link inside one still counts as the link it is.
    expect(events(sent)).toEqual([
      ["outbound-click", { url: "https://example.org/x" }],
      ["outbound-click", { url: "https://example.org/path" }],
    ]);
  });
}

test("drops Umami's own data-umami-event clicks without delaying navigation", async ({
  page,
  collector,
}) => {
  const { sent } = await collector({ delay: 3000 });
  await page.goto("/");
  await loaded(sent);
  const started = Date.now();
  await page.click("#umami-event");
  await page.waitForURL("**/other");
  expect(Date.now() - started).toBeLessThan(1500);
  expect(sent.some((s) => s.payload.name === "umami-own")).toBe(false);
});

test("counts scroll depth only after the visitor scrolls, once per depth", async ({
  page,
  collector,
}) => {
  const { sent } = await collector();
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

test("reports visible seconds each time the page is hidden, never hidden time", async ({
  page,
  collector,
}) => {
  const { sent } = await collector();
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

test("loads once even when the module is included twice", async ({ page, collector }) => {
  const { sent, requested } = await collector();
  await page.goto("/double");
  await loaded(sent);
  await page.waitForTimeout(500);
  expect(pageviews(sent)).toHaveLength(1);
  expect(requested.filter((path) => path === "/script.js")).toHaveLength(1);
});

test("the before-send hook cannot be replaced by page scripts", async ({ page, collector }) => {
  const { sent } = await collector();
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

test("never sends identify calls", async ({ page, collector }) => {
  const { sent } = await collector();
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

test("stops sending as soon as the visitor opts out", async ({ page, collector }) => {
  const { sent } = await collector();
  await page.goto("/");
  await loaded(sent);
  await page.evaluate(() => localStorage.setItem("umami.disabled", "1"));
  await page.click("#outbound");
  await page.waitForTimeout(300);
  expect(events(sent)).toEqual([]);
});

test("drops events when the tracker fails to load", async ({ page, collector }) => {
  const { sent } = await collector({ fail: true });
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
  test(`does not load the tracker with ${name}`, async ({ page, collector }) => {
    const { requested } = await collector();
    await block(page);
    await page.goto("/");
    await expect.poll(() => state(page)).toBe("blocked");
    expect(requested).toEqual([]);
  });
}

test("does not load the tracker for automation or another hostname", async ({
  page,
  collector,
}) => {
  const automated = await collector({ human: false });
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

test("ignores a spoofed or invalid config", async ({ page, collector }) => {
  const { requested } = await collector();
  await page.goto("/spoofed");
  await page.waitForLoadState("load");
  await page.goto("/bad-collector");
  await page.waitForLoadState("load");
  await page.goto("/unknown-declared");
  await page.waitForLoadState("load");
  await page.waitForTimeout(300);
  expect(requested).toEqual([]);
  expect(await page.evaluate(() => "pwned" in window)).toBe(false);
  expect(await state(page)).toBeNull();
});

test("opt-out controls toggle counting and stay in sync", async ({ page, collector }) => {
  await collector();
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
