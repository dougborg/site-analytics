/**
 * The contract with Umami 3.4.0's own tracker, which production serves from
 * stats.dougborg.net/script.js. Every test here runs in Chromium, Firefox, and WebKit, and every
 * recorded request must pass the 3.4.0 collector's schema (see ./umami-server.ts).
 */
import {
  events,
  expect,
  loaded,
  pageviews,
  type Sent,
  setVisibility,
  state,
  test,
} from "./collector.ts";

const performanceOf = (sent: Sent[]) => sent.filter((s) => s.type === "performance");

test("configures Umami's tracker with exactly the documented attributes", async ({
  page,
  collector,
}) => {
  const { sent } = await collector();
  await page.goto("/");
  await loaded(sent);
  const attributes = await page
    .locator('script[src="https://stats.example.test/script.js"]')
    .evaluate((script) =>
      Object.fromEntries(
        script
          .getAttributeNames()
          .filter((name) => name.startsWith("data-"))
          .map((name) => [name, script.getAttribute(name)]),
      ),
    );
  expect(attributes).toEqual({
    "data-website-id": "00000000-0000-4000-8000-000000000000",
    "data-host-url": "https://stats.example.test",
    "data-domains": "127.0.0.1",
    "data-do-not-track": "true",
    "data-exclude-hash": "true",
    "data-performance": "true",
    "data-before-send": "siteAnalyticsBeforeSend",
  });
});

test("a page view has Umami's event shape and nothing that identifies the visitor", async ({
  page,
  collector,
}) => {
  const { sent } = await collector();
  await page.goto("/");
  await loaded(sent);
  const [view] = pageviews(sent);
  expect(Object.keys(view.payload).sort()).toEqual(
    ["hostname", "language", "referrer", "screen", "title", "url", "website"].sort(),
  );
  expect(view.payload).toMatchObject({
    website: "00000000-0000-4000-8000-000000000000",
    hostname: "127.0.0.1",
    title: "Fixture home",
    url: "https://127.0.0.1:4175/",
  });
});

test("a module event is an Umami custom event with a name and data", async ({
  page,
  collector,
}) => {
  const { sent } = await collector();
  await page.goto("/");
  await loaded(sent);
  await page.click("#outbound");
  await expect.poll(() => events(sent).length).toBe(1);
  const event = sent.find((s) => s.payload.name);
  expect(event?.type).toBe("event");
  expect(event?.payload).toMatchObject({
    website: "00000000-0000-4000-8000-000000000000",
    url: "https://127.0.0.1:4175/",
    name: "outbound-click",
    data: { url: "https://example.org/path" },
  });
});

test("sends Web Vitals as a performance record when the page is hidden", async ({
  page,
  collector,
}) => {
  const { sent } = await collector();
  await page.goto("/");
  await loaded(sent);
  await page.click("#internal");
  await setVisibility(page, "hidden");
  await expect.poll(() => performanceOf(sent).length).toBe(1);
  const [record] = performanceOf(sent);
  const metrics = ["ttfb", "fcp", "lcp", "cls", "inp", "duration"];
  const allowed = ["website", "hostname", "screen", "language", "title", "url", "referrer"];
  for (const key of Object.keys(record.payload)) expect([...allowed, ...metrics]).toContain(key);
  // Every engine reports navigation timing; which paint metrics exist varies by engine.
  expect(typeof record.payload.ttfb).toBe("number");
  expect(typeof record.payload.duration).toBe("number");
  expect(record.payload.url).toBe("https://127.0.0.1:4175/");
});

test("a history navigation sends the previous page's performance, then a page view", async ({
  page,
  collector,
}) => {
  const { sent } = await collector();
  await page.goto("/?utm_source=a&secret=1");
  await loaded(sent);
  await page.evaluate(() => history.pushState({}, "", "/other?token=abc#x"));
  await expect.poll(() => pageviews(sent).length).toBe(2);
  const [record] = performanceOf(sent);
  expect(record.payload.url).toBe("https://127.0.0.1:4175/?utm_source=a");
  expect(pageviews(sent)[1].payload.url).toBe("https://127.0.0.1:4175/other");
});

test("identify never reaches the collector and never tags later records", async ({
  page,
  collector,
}) => {
  const { sent } = await collector();
  await page.goto("/");
  await loaded(sent);
  await page.evaluate(() => {
    const { umami } = window as unknown as {
      umami: { identify(id: string, data?: object): Promise<void> };
    };
    return umami.identify("visitor-123", { email: "bob@example.com" });
  });
  await page.evaluate(() => history.pushState({}, "", "/other"));
  await expect.poll(() => pageviews(sent).length).toBe(2);
  await page.click("#outbound");
  await setVisibility(page, "hidden");
  await expect.poll(() => performanceOf(sent).length).toBeGreaterThan(0);
  await expect.poll(() => events(sent).length).toBeGreaterThan(0);
  expect(sent.map((s) => s.type)).not.toContain("identify");
  for (const { payload } of sent) expect(payload).not.toHaveProperty("id");
  expect(JSON.stringify(sent)).not.toContain("visitor-123");
});

test("page scripts cannot send their own named events through Umami", async ({
  page,
  collector,
}) => {
  const { sent } = await collector();
  await page.goto("/");
  await loaded(sent);
  await page.evaluate(() => {
    const { umami } = window as unknown as {
      umami: { track(name: string, data?: object): Promise<void> };
    };
    return umami.track("search", { query: "bob@example.com" });
  });
  await page.click("#outbound");
  await expect.poll(() => events(sent).length).toBe(1);
  expect(events(sent)).toEqual([["outbound-click", { url: "https://example.org/path" }]]);
});

const laterSignals: [string, () => void][] = [
  ["the opt-out flag", () => localStorage.setItem("umami.disabled", "1")],
  [
    "Global Privacy Control",
    () => Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true }),
  ],
  [
    "Do Not Track",
    () => Object.defineProperty(Navigator.prototype, "doNotTrack", { get: () => "1" }),
  ],
];

for (const [name, signal] of laterSignals) {
  test(`${name} after load stops page views, events, and performance`, async ({
    page,
    collector,
  }) => {
    const { sent } = await collector();
    await page.goto("/");
    await loaded(sent);
    const before = sent.length;
    await page.evaluate(signal);
    await page.evaluate(() => history.pushState({}, "", "/other"));
    await page.click("#outbound");
    await setVisibility(page, "hidden");
    await page.waitForTimeout(600);
    expect(sent.slice(before)).toEqual([]);
    expect(await state(page)).toBe("loaded");
  });
}

/**
 * Records every request the page hands to `fetch`, in session storage so it survives leaving the
 * page. Chromium sends keepalive requests made while a page unloads without Playwright seeing
 * them, so this is how every engine shows what was sent on the way out.
 */
function recordFetches() {
  const original = window.fetch;
  window.fetch = (input, init) => {
    const log = JSON.parse(sessionStorage.getItem("fetches") ?? "[]");
    log.push({ body: JSON.parse(String(init?.body ?? "null")), keepalive: init?.keepalive });
    sessionStorage.setItem("fetches", JSON.stringify(log));
    return original(input, init);
  };
}

test("leaving the page hands engaged time and performance to keepalive requests", async ({
  page,
  collector,
}) => {
  const { sent } = await collector();
  await page.addInitScript(recordFetches);
  await page.goto("/");
  await loaded(sent);
  await page.waitForTimeout(1200);
  await page.goto("/other");
  await expect.poll(() => pageviews(sent).length).toBe(2);
  const fetches: { body: Sent; keepalive: boolean }[] = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("fetches") ?? "[]"),
  );
  const leaving = fetches
    .filter(({ body }) => body.payload.url === "https://127.0.0.1:4175/")
    .filter(({ body }) => body.type === "performance" || body.payload.name);
  expect(leaving.map(({ body }) => body.payload.name ?? body.type).sort()).toEqual([
    "engaged-time",
    "performance",
  ]);
  expect(leaving.every(({ keepalive }) => keepalive)).toBe(true);
  expect(leaving.find(({ body }) => body.payload.name)?.body.payload.data).toEqual({ seconds: 1 });
});
