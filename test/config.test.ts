import assert from "node:assert/strict";
import test from "node:test";
import { analyticsConfig, configElement, privacyNotice } from "../src/index.ts";

const valid = {
  websiteId: "00000000-0000-4000-8000-000000000000",
  collector: "https://stats.example.com",
  hostname: "example.com",
};

test("accepts a valid config and normalizes the collector origin", () => {
  assert.deepEqual(analyticsConfig({ ...valid, collector: "https://stats.example.com/" }), {
    ...valid,
    declaredEvents: [],
  });
});

test("the config element lists the site's declared events, and none by default", () => {
  const parse = (html: string) => JSON.parse(html.replace(/^<[^>]+>|<\/script>$/g, ""));
  assert.deepEqual(parse(configElement(valid)).declaredEvents, []);
  assert.deepEqual(
    parse(configElement({ ...valid, declaredEvents: ["theme-toggle"] })).declaredEvents,
    ["theme-toggle"],
  );
});

test("lists every problem in an invalid config", () => {
  assert.throws(
    () => analyticsConfig({ websiteId: "abc", collector: "http://x.test/path", hostname: "Nope" }),
    /websiteId must be a UUID; collector must be an https origin with no path; hostname must be a lowercase domain name/,
  );
});

test("the config element cannot close its script tag", () => {
  const html = configElement(valid);
  assert.match(html, /^<script type="application\/json" id="site-analytics">\{.*\}<\/script>$/);
  assert.equal(JSON.parse(html.replace(/^<[^>]+>|<\/script>$/g, "")).hostname, "example.com");
});

const notice = {
  site: "example.com",
  controller: { name: "A <Person>", email: "a@example.com" },
  analytics: valid,
  hosting: "on a server at home",
  country: "the United States",
  retentionDays: 90,
  updated: "2026-09-22",
};

test("the notice escapes its inputs and states the retention and date", () => {
  const html = privacyNotice(notice);
  assert.match(html, /A &#60;Person&#62;/);
  assert.match(html, /delete records after 90 days/);
  assert.match(html, /in the United States/);
  assert.match(html, /<time datetime="2026-09-22">September 22, 2026<\/time>/);
  assert.match(html, /stats\.example\.com/);
  assert.doesNotMatch(html, /Requests reach it through/);
});

test("the notice names every interaction event the module sends", () => {
  const html = privacyNotice({
    ...notice,
    analytics: { ...valid, declaredEvents: ["theme-toggle"] },
  });
  for (const phrase of [
    "theme switch",
    "scroll",
    "seconds the page was visible",
    "leaves the site",
    "file download",
    "email or phone link",
    "Web Vitals",
    "utm_",
  ]) {
    assert.ok(html.includes(phrase), phrase);
  }
});

test("the notice rejects inputs that would render wrong or unsafe", () => {
  const cases: [Partial<typeof notice> & Record<string, unknown>, RegExp][] = [
    [{ updated: "Sept 22" }, /YYYY-MM-DD/],
    [{ updated: "2026-02-31" }, /YYYY-MM-DD/],
    [{ retentionDays: 0 }, /whole number/],
    [{ retentionDays: Number.POSITIVE_INFINITY }, /whole number/],
    [{ retentionDays: 1.5 }, /whole number/],
    [{ controller: { name: "A", email: "a@example.com?cc=b@example.com" } }, /plain email/],
    [{ network: { name: "N", privacyUrl: "javascript:alert(1)" } }, /https URL/],
    [{ analytics: { ...valid, collector: "http://stats.example.com" } }, /https origin/],
    [{ analytics: { ...valid, websiteId: "abc" } }, /websiteId must be a UUID/],
    [{ country: " " }, /country must not be empty/],
    [{ analytics: undefined, collector: "https://stats.example.com" }, /analytics must be/],
  ];
  for (const [change, error] of cases) {
    assert.throws(() => privacyNotice({ ...notice, ...change } as typeof notice), error);
  }
});

test("the notice is honest about identifiers and linking", () => {
  const html = privacyNotice(notice);
  assert.match(html, /stays the same for that calendar month/);
  assert.match(html, /a promise about how I use the data, not a technical barrier/);
  assert.doesNotMatch(html, /only thing this site stores/);
});
