/**
 * A test-time check for a site's built pages: every event a page can send must be in the privacy
 * notice. It does not tokenise HTML, because any disagreement with the browser's tokeniser would
 * hide a config. It over-reports instead: every JSON object anywhere in the page that could be a
 * config counts, and so does a declared event's name near any `data-analytics-event` attribute.
 * Page scripts are outside what it can see.
 */
import { COLLECTION, DECLARED_EVENTS, declaredEventNames, siteEvents } from "./contract.ts";

const EVENT_LIST = '<ul id="events">';
const ANY_EVENT_LIST = /\bid\s*=\s*["']?events(?=["'\s/>])/gi;
const ITEM = /<li><code>([^<]+)<\/code>/g;
/** Characters JSON allows outside a string; anything else ends the candidate early. */
const JSON_OUTSIDE_STRING = /[\s\d{}[\],:.+\-eEtrufalsn]/;
/** The attribute and its value, with any spacing and quoting the browser allows. */
const MARKUP_EVENT = /data-analytics-event\s*=\s*["']?\s*([a-z0-9-]+)/g;

const NAMED: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };

/**
 * Numeric character references and the named ones that can spell JSON or an attribute value. An
 * attribute's value is decoded by the browser, and so is a script's text in an XHTML page.
 */
function decodeReferences(html: string) {
  return html
    .replace(/&#x([0-9a-f]{1,6});?/gi, (_, hex: string) => codePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d{1,7});?/g, (_, dec: string) => codePoint(Number(dec)))
    .replace(/&(amp|quot|apos|lt|gt);?/gi, (_, name: string) => NAMED[name.toLowerCase()]);
}

const codePoint = (value: number) => (value <= 0x10ffff ? String.fromCodePoint(value) : "�");

/** The index just past the JSON string whose opening quote is at `start`, or -1. */
function stringEnd(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === '"') return i + 1;
  }
  return -1;
}

const NESTING: Record<string, number> = { "{": 1, "[": 1, "}": -1, "]": -1 };

/** The end of the JSON value starting at `start` (a `{`), or -1 if it cannot be one. */
function jsonEnd(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length && i !== -1; ) {
    const char = text[i];
    if (char === '"') {
      i = stringEnd(text, i);
      continue;
    }
    if (!JSON_OUTSIDE_STRING.test(char)) return -1;
    depth += NESTING[char] ?? 0;
    i++;
    if (depth === 0) return i;
  }
  return -1;
}

/** Every JSON object in the text that has a key only a config would have. */
function configsIn(text: string): Record<string, unknown>[] {
  const configs: Record<string, unknown>[] = [];
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    const end = jsonEnd(text, start);
    if (end === -1) continue;
    let value: unknown;
    try {
      value = JSON.parse(text.slice(start, end));
    } catch {
      continue;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    const object = value as Record<string, unknown>;
    if (Object.hasOwn(object, "websiteId") || Object.hasOwn(object, "declaredEvents")) {
      configs.push(object);
    }
  }
  return configs;
}

/** Events any config-like JSON on the page, as written or decoded, lets the module send. */
function configEvents(page: string): string[] {
  return [...configsIn(page), ...configsIn(decodeReferences(page))].flatMap((config) => {
    const declared = config.declaredEvents ?? [];
    const valid = declaredEventNames(declared);
    if (!valid) throw new Error(`The page declares unknown events: ${JSON.stringify(declared)}`);
    return siteEvents(valid);
  });
}

/**
 * Declared events named near any `data-analytics-event` attribute, which a stale copy of the module
 * from an earlier release would send whatever the config says.
 */
function markupEvents(page: string): string[] {
  const text = decodeReferences(page).toLowerCase();
  return [...text.matchAll(MARKUP_EVENT)]
    .map((match) => match[1])
    .filter((name) => Object.hasOwn(DECLARED_EVENTS, name));
}

function listedEvents(notice: string): Set<string> {
  const lists = notice.match(ANY_EVENT_LIST)?.length ?? 0;
  if (lists > 1) throw new Error("The notice has more than one event list");
  // indexOf rather than a lazy regex, which is quadratic on a list that never closes.
  const start = notice.indexOf(EVENT_LIST);
  const end = start === -1 ? -1 : notice.indexOf("</ul>", start);
  if (end === -1) throw new Error("The notice has no event list");
  const list = notice.slice(start + EVENT_LIST.length, end);
  return new Set([...list.matchAll(ITEM)].map((match) => match[1]));
}

/**
 * The events a built page can send that its site's privacy notice does not list, in contract
 * order; an empty array means the notice discloses everything. `page` is a tracked page's HTML,
 * as decoded text (it assumes text/html; an XHTML page's entity-encoded config is also read), and
 * `notice` is the privacy page's HTML (or `privacyNotice()` output). Run it over every built page
 * in the site's tests. Throws if the notice does not have exactly one event list, or a config on
 * the page names an event outside `DECLARED_EVENTS`.
 */
export function undisclosedEvents(page: string, notice: string): string[] {
  const listed = listedEvents(notice);
  const sendable = new Set([...configEvents(page), ...markupEvents(page)]);
  return Object.keys(COLLECTION).filter((name) => sendable.has(name) && !listed.has(name));
}
