import assert from "node:assert/strict";
import test from "node:test";
import { analyticsConfig, configElement, privacyNotice } from "../src/index.ts";

const valid = {
  websiteId: "00000000-0000-4000-8000-000000000000",
  collector: "https://stats.example.com",
  hostname: "example.com",
};

test("accepts a valid config and normalizes the collector origin", () => {
  assert.deepEqual(analyticsConfig({ ...valid, collector: "https://stats.example.com/" }), valid);
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
  collector: "https://stats.example.com",
  hosting: "on a server at home",
  retentionDays: 90,
  updated: "2026-09-22",
};

test("the notice escapes its inputs and states the retention and date", () => {
  const html = privacyNotice(notice);
  assert.match(html, /A &#60;Person&#62;/);
  assert.match(html, /deleted after 90 days/);
  assert.match(html, /<time datetime="2026-09-22">September 22, 2026<\/time>/);
  assert.match(html, /stats\.example\.com/);
  assert.doesNotMatch(html, /Requests reach it through/);
});

test("the notice names every interaction event the module sends", () => {
  const html = privacyNotice(notice);
  for (const phrase of [
    "scroll",
    "seconds the page was visible",
    "leave the site",
    "file downloads",
    "email or phone links",
    "Web Vitals",
    "utm_",
  ]) {
    assert.ok(html.includes(phrase), phrase);
  }
});

test("the notice rejects a bad date or retention", () => {
  assert.throws(() => privacyNotice({ ...notice, updated: "Sept 22" }), /YYYY-MM-DD/);
  assert.throws(() => privacyNotice({ ...notice, retentionDays: 0 }), /positive/);
});
