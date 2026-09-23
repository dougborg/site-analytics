import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  allowedEvent,
  BUILT_IN_EVENTS,
  COLLECTION,
  DECLARED_EVENTS,
  declaredEventAttributes,
  type Field,
  privacyNotice,
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

const notice = privacyNotice({
  site: "example.com",
  controller: { name: "A", email: "a@example.com" },
  collector: "https://stats.example.com",
  hosting: "at home",
  country: "the United States",
  retentionDays: 90,
  updated: "2026-09-23",
});

test("the notice lists exactly the contract's events, each with every field", () => {
  const list = notice.match(/<ul id="events">\n([\s\S]*?)\n<\/ul>/)?.[1] ?? "";
  const items = list.split("\n");
  assert.deepEqual(
    items.map((item) => item.match(/^<li><code>([^<]+)<\/code>/)?.[1]),
    Object.keys(COLLECTION),
  );
  for (const [index, [name, spec]] of Object.entries(COLLECTION).entries()) {
    const fields = [
      ...items[index].matchAll(/with <code>([^<]+)<\/code>|and <code>([^<]+)<\/code>:/g),
    ];
    assert.deepEqual(
      fields.map((match) => match[1] ?? match[2]),
      Object.keys(spec.fields),
      name,
    );
  }
});

test("the notice lists every allowed value of a choice", () => {
  for (const [name, { fields }] of Object.entries(COLLECTION)) {
    for (const field of Object.values(fields)) {
      if (field.kind !== "choice") continue;
      for (const value of field.values) assert.ok(notice.includes(`<code>${value}</code>`), name);
    }
  }
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
