import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  allowedEvent,
  BUILT_IN_EVENTS,
  COLLECTION,
  configElement,
  DECLARED_EVENTS,
  type DeclaredEventName,
  declaredEventAttributes,
  type Field,
  privacyNotice,
  siteEvents,
  undisclosedEvents,
} from "../src/index.ts";

/** Lowercase words joined by hyphens: no spaces, markup, addresses, URLs, or bare numbers. */
const SLUG = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
/**
 * Words that suggest a name, field, or value could carry typed input, contact details, account
 * identifiers, DOM text or classes, or search terms. A contract change that needs one of them
 * needs a privacy review first, and then a change to this list.
 */
const SENSITIVE = new Set([
  ...["email", "mail", "phone", "tel", "address", "name", "user", "username"],
  ...["account", "login", "id", "uid", "uuid", "token", "session", "password", "ip", "location"],
  ...["input", "query", "search", "text", "label", "class", "selector", "message", "comment"],
  ...["content", "value", "html", "title", "href", "hash", "fragment"],
]);

/** Reviewed uses of a sensitive word: `contact-click` names the kind of link, never its target. */
const REVIEWED = new Set(["contact-click.method=email", "contact-click.method=phone"]);

const sensitiveWord = (slug: string) => slug.split("-").find((word) => SENSITIVE.has(word));

/** Umami truncates names past 50 characters and rejects ones that could start a formula. */
function slugProblems(label: string, slug: string): string[] {
  const found: string[] = [];
  if (!SLUG.test(slug) || slug.length > 40) found.push(`${label}: not a slug`);
  const word = sensitiveWord(slug);
  if (word && !REVIEWED.has(label)) found.push(`${label}: sensitive word "${word}"`);
  return found;
}

function fieldProblems(event: string, key: string, field: Field): string[] {
  const found = slugProblems(`${event}.${key}`, key);
  if (field.kind === "choice") {
    for (const value of field.values)
      found.push(...slugProblems(`${event}.${key}=${value}`, value));
  }
  if (!field.meaning.trim()) found.push(`${event}.${key}: no meaning for the notice`);
  return found;
}

function declaredProblems(): string[] {
  const found: string[] = [];
  for (const [name, { fields }] of Object.entries(DECLARED_EVENTS)) {
    if (name in BUILT_IN_EVENTS) found.push(`${name}: declared and built in`);
    for (const [key, field] of Object.entries(fields)) {
      if ((field as Field).kind !== "choice") found.push(`${name}.${key}: declared, not a choice`);
    }
  }
  return found;
}

/** Every rule a contract change must keep; the runtime check only enforces what is listed. */
function contractProblems(): string[] {
  const found = declaredProblems();
  for (const [name, spec] of Object.entries(COLLECTION)) {
    found.push(...slugProblems(name, name));
    if (!spec.when.trim()) found.push(`${name}: no "when" for the notice`);
    if (!Object.keys(spec.fields).length) found.push(`${name}: no fields`);
    for (const [key, field] of Object.entries(spec.fields)) {
      found.push(...fieldProblems(name, key, field));
    }
  }
  return found;
}

test("the collection contract keeps its own rules", () => {
  assert.deepEqual(contractProblems(), []);
});

test("allows each event only with exactly its fields and allowed values", () => {
  const allowed: [string, Record<string, unknown>][] = [
    ["scroll-depth", { depth: 50 }],
    ["engaged-time", { seconds: 3600 }],
    ["outbound-click", { url: "https://example.org/a/[email]/b" }],
    ["download-click", { format: "pdf", file: "resume.pdf" }],
    ["download-click", { format: "file", file: "export" }],
    ["contact-click", { method: "phone" }],
    ["theme-toggle", { theme: "dark" }],
  ];
  for (const [name, data] of allowed) assert.ok(allowedEvent(name, data), `${name} ${data}`);
});

test("rejects names, fields, and values outside the contract", () => {
  const rejected: [string, Record<string, unknown>][] = [
    ["signup", {}],
    ["__proto__", {}],
    ["toString", {}],
    ["theme-toggle", {}],
    ["theme-toggle", { theme: "dark", extra: "x" }],
    ["theme-toggle", { theme: "Dark" }],
    ["theme-toggle", { theme: "bob@example.com" }],
    ["theme-toggle", { theme: "hello world" }],
    ["theme-toggle", { theme: "btn btn-primary" }],
    ["theme-toggle", { theme: "12345" }],
    ["scroll-depth", { depth: 60 }],
    ["scroll-depth", { depth: "50" }],
    ["engaged-time", { seconds: 0 }],
    ["engaged-time", { seconds: 1.5 }],
    ["engaged-time", { seconds: 3601 }],
    ["outbound-click", { url: "https://example.org/path?q=secret" }],
    ["outbound-click", { url: "https://example.org/path#section" }],
    ["outbound-click", { url: "https://user:pw@example.org/path" }],
    ["outbound-click", { url: "mailto:bob@example.com" }],
    ["outbound-click", { url: "javascript:alert(1)" }],
    ["outbound-click", { url: "/relative" }],
    ["download-click", { format: "exe", file: "a.exe" }],
    ["download-click", { format: "pdf", file: "a/b.pdf" }],
    ["download-click", { format: "pdf", file: "a.pdf?token=1" }],
    ["download-click", { format: "pdf", file: "" }],
    ["contact-click", { method: "email", address: "bob@example.com" }],
    ["contact-click", { method: "bob@example.com" }],
  ];
  for (const [name, data] of rejected) {
    assert.equal(allowedEvent(name, data), false, `${name} ${JSON.stringify(data)}`);
  }
});

test("declared-event markup comes only from the contract", () => {
  assert.equal(
    declaredEventAttributes("theme-toggle", { theme: "dark" }),
    'data-analytics-event="theme-toggle" data-analytics-theme="dark"',
  );
  assert.throws(
    () => declaredEventAttributes("theme-toggle", { theme: "bob@example.com" } as never),
    /Not an allowed declared event/,
  );
  assert.throws(
    () => declaredEventAttributes("scroll-depth" as never, { depth: 50 } as never),
    /Not an allowed declared event/,
  );
});

const siteConfig = {
  websiteId: "00000000-0000-4000-8000-000000000000",
  collector: "https://stats.example.com",
  hostname: "example.com",
};

/** A site's notice, built from the same config as its pages. */
const noticeFor = (declaredEvents: DeclaredEventName[] = []) =>
  privacyNotice({
    site: "example.com",
    controller: { name: "A", email: "a@example.com" },
    analytics: { ...siteConfig, declaredEvents },
    hosting: "at home",
    country: "the United States",
    retentionDays: 90,
    updated: "2026-09-23",
  });

/** Every list of declared events a site could pass: each subset of `DECLARED_EVENTS`. */
function declaredSubsets(): DeclaredEventName[][] {
  let subsets: DeclaredEventName[][] = [[]];
  for (const name of Object.keys(DECLARED_EVENTS) as DeclaredEventName[]) {
    subsets = subsets.flatMap((subset) => [subset, [...subset, name]]);
  }
  return subsets;
}

/** The notice's event list items, in order. */
const listedItems = (html: string) =>
  (html.match(/<ul id="events">\n([\s\S]*?)\n<\/ul>/)?.[1] ?? "").split("\n");

test("the notice lists exactly the site's events, each with every field", () => {
  for (const declaredEvents of declaredSubsets()) {
    const items = listedItems(noticeFor(declaredEvents));
    const expected = siteEvents(declaredEvents);
    assert.deepEqual(
      items.map((item) => item.match(/^<li><code>([^<]+)<\/code>/)?.[1]),
      expected,
      JSON.stringify(declaredEvents),
    );
    for (const [index, name] of expected.entries()) {
      const fields = [
        ...items[index].matchAll(/with <code>([^<]+)<\/code>|and <code>([^<]+)<\/code>:/g),
      ];
      assert.deepEqual(
        fields.map((match) => match[1] ?? match[2]),
        Object.keys(COLLECTION[name].fields),
        name,
      );
    }
  }
});

test("a site's events are every built-in event plus only the declared events it lists", () => {
  assert.deepEqual(siteEvents([]), Object.keys(BUILT_IN_EVENTS));
  assert.deepEqual(
    siteEvents(Object.keys(DECLARED_EVENTS) as DeclaredEventName[]),
    Object.keys(COLLECTION),
  );
  assert.doesNotMatch(noticeFor(), /theme-toggle|theme switch/);
});

test("the notice lists every allowed value of a choice it names", () => {
  const notice = noticeFor(Object.keys(DECLARED_EVENTS) as DeclaredEventName[]);
  for (const [name, { fields }] of Object.entries(COLLECTION)) {
    for (const field of Object.values(fields)) {
      if (field.kind !== "choice") continue;
      for (const value of field.values) assert.ok(notice.includes(`<code>${value}</code>`), name);
    }
  }
});

test("declared events outside the contract are refused by the config and the notice", () => {
  for (const declaredEvents of [
    ["signup"],
    ["scroll-depth"],
    ["theme-toggle", "theme-toggle"],
    ["__proto__"],
    "theme-toggle",
  ]) {
    const bad = declaredEvents as DeclaredEventName[];
    assert.throws(() => noticeFor(bad), /declaredEvents must list/);
    assert.throws(
      () => configElement({ ...siteConfig, declaredEvents: bad }),
      /declaredEvents must list/,
    );
  }
});

test("a page and its notice built from the same config disclose every event it can send", () => {
  for (const declaredEvents of declaredSubsets()) {
    const markup = declaredEvents.includes("theme-toggle")
      ? `<button ${declaredEventAttributes("theme-toggle", { theme: "dark" })}>Theme</button>`
      : "";
    const page = `<main>${markup}</main>${configElement({ ...siteConfig, declaredEvents })}`;
    assert.deepEqual(
      undisclosedEvents(page, noticeFor(declaredEvents)),
      [],
      JSON.stringify(declaredEvents),
    );
  }
});

test("finds events a page can send that its notice leaves out", () => {
  const page = configElement({ ...siteConfig, declaredEvents: ["theme-toggle"] });
  assert.deepEqual(undisclosedEvents(page, noticeFor()), ["theme-toggle"]);
  // A page without a config element sends nothing, so it needs nothing disclosed.
  assert.deepEqual(undisclosedEvents("<main></main>", noticeFor()), []);
  // A notice missing a built-in event, such as one from an older release, fails too.
  const older = noticeFor().replace(/<li><code>scroll-depth<\/code>.*\n/, "");
  assert.deepEqual(undisclosedEvents(configElement(siteConfig), older), ["scroll-depth"]);
});

test("reads every config and declared-event attribute the browser would, however it is written", () => {
  const json = JSON.stringify({ ...siteConfig, declaredEvents: ["theme-toggle"] });
  const configs = [
    `<script type="application/json" id = "site-analytics">${json}</script>`,
    `<script type="application/json" id=\n"site-analytics">${json}</script>`,
    `<script type="application/json"id="site-analytics">${json}</script>`,
    `<script/id="site-analytics" type="application/json">${json}</script>`,
    `<script data-x="a>b" type="application/json" id="site-analytics">${json}</script>`,
    `<script type="application/json" id="site&#45;analytics">${json}</script>`,
    `<SCRIPT TYPE=application/json ID=site-analytics>${json}</SCRIPT >`,
    `<script type="application/json" id="site-analytics">${json.replace("theme", "\\u0074heme")}</script>`,
    `<script type="application/json" id="site-analytics">${json}</script/>`,
    `<script type="application/json" id="site-analytics">${json}</script foo>`,
    `<!-- <script> old --><script type="application/json" id="site-analytics">${json}</script>`,
    `<meta content="<script>"><script type="application/json" id="site-analytics">${json}</script>`,
    `<title><script></title><script type="application/json" id="site-analytics">${json}</script>`,
    `<script data-x=a"b type="application/json" id="site-analytics">${json}</script>`,
    `<script type="application/json" id="site-analytics">${json.replace('"websiteId"', '"\\u0077ebsiteId"')}</script>`,
    `<script type="application/json" id="site-analytics">${json.replaceAll('"', "&quot;")}</script>`,
  ];
  // A theme switch kept in the markup while the config no longer declares it, as a stale copy of
  // the module from an earlier release would still send it.
  const markup = [
    `<button data-analytics-event="theme-toggle">x</button>`,
    `<button data-analytics-event = 'theme-toggle'>x</button>`,
    `<button DATA-ANALYTICS-EVENT=theme&#x2d;toggle>x</button>`,
    `<button title="a>b" data-analytics-event="theme-toggle">x</button>`,
    `<button data-x=a"b data-analytics-event="theme-toggle">x</button>`,
    `<button data-analytics-event${" ".repeat(300)}="theme-toggle">x</button>`,
    `<!-- <script> --><button data-analytics-event="&#116;heme-toggle">x</button>`,
  ];
  for (const page of [...configs, ...markup.map((tag) => tag + configElement(siteConfig))]) {
    assert.deepEqual(undisclosedEvents(page, noticeFor()), ["theme-toggle"], page);
  }
});

test("refuses a notice or a page it cannot check", () => {
  const page = configElement(siteConfig);
  assert.throws(() => undisclosedEvents(page, "<p>No list</p>"), /no event list/);
  const twice = `<ul id="events"><li><code>theme-toggle</code></li></ul>${noticeFor()}`;
  assert.throws(() => undisclosedEvents(page, twice), /more than one event list/);
  const commented = `<!-- <ul id=events></ul> -->${noticeFor()}`;
  assert.throws(() => undisclosedEvents(page, commented), /more than one event list/);
  const invalid =
    '<script type="application/json" id="site-analytics">{"declaredEvents":["signup"]}</script>';
  assert.throws(() => undisclosedEvents(invalid, noticeFor()), /unknown events/);
});

test("the README's collection table lists exactly the contract's events", async () => {
  const readme = await readFile("README.md", "utf8");
  const table = readme.slice(
    readme.indexOf("## What it collects"),
    readme.indexOf("Anything that"),
  );
  const named = [...table.matchAll(/^\| `([a-z-]+)` \|/gm)].map((match) => match[1]);
  // `performance` is Umami's own Web Vitals record, not an event in the contract.
  assert.deepEqual(
    named.filter((name) => name !== "performance"),
    Object.keys(COLLECTION),
  );
});
