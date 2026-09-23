/**
 * The collection contract shared by every site: each named event this package can send, each field
 * of each event, and the values each field may hold. The browser module drops any event outside it,
 * the privacy notice lists all of it, and tests fail if the README, the notice, or the module drift
 * from it. Widening it is a `feat` that needs a privacy review and a new notice date on every site.
 *
 * This file has no imports: the build inlines it into the self-contained browser module.
 */

interface FieldBase {
  /** What the field records, as a phrase for the privacy notice. */
  readonly meaning: string;
}

/** One of a fixed set of words. The only kind a declared event may use. */
export interface ChoiceField extends FieldBase {
  readonly kind: "choice";
  readonly values: readonly string[];
}

/** What each field may hold. Nothing free-form: every kind has a fixed shape or set of values. */
export type Field =
  | ChoiceField
  | (FieldBase & { readonly kind: "number"; readonly values: readonly number[] })
  | (FieldBase & { readonly kind: "whole"; readonly min: number; readonly max: number })
  /** An http or https URL reduced to its origin and path: no query, fragment, or credentials. */
  | (FieldBase & { readonly kind: "page" })
  /** One path segment, such as `resume.pdf`, with any email address already replaced. */
  | (FieldBase & { readonly kind: "file" });

export interface EventSpec {
  /** When it is sent, as a phrase that follows "sent" in the privacy notice. */
  readonly when: string;
  /** Every field it carries; each is required. */
  readonly fields: Readonly<Record<string, Field>>;
}

/** A site-declared event: a named control whose fields are all fixed choices. */
export interface DeclaredEventSpec extends EventSpec {
  readonly fields: Readonly<Record<string, ChoiceField>>;
}

/** Same-origin links to these file types count as downloads; static sites link files, not APIs. */
export const DOWNLOAD_FORMATS = ["pdf", "docx", "md", "json", "zip", "csv", "txt", "epub"] as const;

/** Scroll depths reported, in percent of the page. */
export const SCROLL_DEPTHS = [25, 50, 75, 100] as const;

/** Events the browser module sends by itself. */
export const BUILT_IN_EVENTS = {
  "scroll-depth": {
    when: "the first time you scroll, yourself, past each depth of a page long enough to scroll",
    fields: {
      depth: {
        kind: "number",
        values: SCROLL_DEPTHS,
        meaning: "how far down the page, in percent",
      },
    },
  },
  "engaged-time": {
    when: "each time the page is hidden or left",
    fields: {
      seconds: {
        kind: "whole",
        min: 1,
        max: 3600,
        meaning: "how many seconds the page was visible since the last report",
      },
    },
  },
  "outbound-click": {
    when: "when you click or middle-click a link that leaves the site",
    fields: { url: { kind: "page", meaning: "the destination's origin and path" } },
  },
  "download-click": {
    when: "when you click a file download",
    fields: {
      format: { kind: "choice", values: [...DOWNLOAD_FORMATS, "file"], meaning: "the file type" },
      file: { kind: "file", meaning: "the file's name" },
    },
  },
  "contact-click": {
    when: "when you click an email or phone link",
    fields: {
      method: {
        kind: "choice",
        values: ["email", "phone"],
        meaning: "which kind of link, never the address or number",
      },
    },
  },
} as const satisfies Record<string, EventSpec>;

/**
 * Events a site may declare on a control with `data-analytics-event="<name>"` and one
 * `data-analytics-<field>="<value>"` attribute per field. Anything else is dropped.
 */
export const DECLARED_EVENTS = {
  "theme-toggle": {
    when: "when you click the site's theme switch",
    fields: {
      theme: {
        kind: "choice",
        values: ["light", "dark", "system"],
        meaning: "the theme chosen",
      },
    },
  },
} as const satisfies Record<string, DeclaredEventSpec>;

/** Every named event this package can send. */
export const COLLECTION: Readonly<Record<EventName, EventSpec>> = {
  ...BUILT_IN_EVENTS,
  ...DECLARED_EVENTS,
};

export type BuiltInEventName = keyof typeof BUILT_IN_EVENTS;
export type DeclaredEventName = keyof typeof DECLARED_EVENTS;
export type EventName = BuiltInEventName | DeclaredEventName;

/**
 * The only payload fields sent to Umami 3.4.0 for page views, events, and Web Vitals; the module
 * drops every other field, including Umami's distinct ID.
 */
export const PAYLOAD_FIELDS = [
  "website",
  "hostname",
  "screen",
  "language",
  "url",
  "referrer",
  "title",
  "name",
  "data",
  "tag",
  ...["ttfb", "fcp", "lcp", "cls", "inp", "duration"],
] as const;

const FILE_NAME = /^[^/?#\s]{1,200}$/;

function isPage(value: unknown): boolean {
  if (typeof value !== "string" || value.length > 200) return false;
  try {
    const url = new URL(value);
    const web = url.protocol === "https:" || url.protocol === "http:";
    return web && !url.username && !url.password && `${url.origin}${url.pathname}` === value;
  } catch {
    return false;
  }
}

function fieldAllows(field: Field, value: unknown): boolean {
  switch (field.kind) {
    case "choice":
      return typeof value === "string" && field.values.includes(value);
    case "number":
      return typeof value === "number" && field.values.includes(value);
    case "whole":
      return Number.isInteger(value) && Number(value) >= field.min && Number(value) <= field.max;
    case "page":
      return isPage(value);
    case "file":
      return typeof value === "string" && FILE_NAME.test(value);
  }
}

/** Whether the contract allows this event with exactly this data. */
export function allowedEvent(name: string, data: Readonly<Record<string, unknown>>): boolean {
  if (!Object.hasOwn(COLLECTION, name)) return false;
  const { fields } = COLLECTION[name as EventName];
  const keys = Object.keys(fields);
  return (
    Object.keys(data).length === keys.length &&
    keys.every((key) => Object.hasOwn(data, key) && fieldAllows(fields[key], data[key]))
  );
}
