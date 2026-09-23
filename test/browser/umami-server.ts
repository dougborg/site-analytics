/**
 * What Umami 3.4.0's collector accepts at `/api/send`, transcribed from
 * https://github.com/umami-software/umami/blob/v3.4.0/src/app/api/send/route.ts (commit ec0ff50).
 * A payload it rejects is lost, so every payload the browser tests record must pass. Review this
 * file whenever the collector moves to another Umami version.
 */
type Sent = { type: string; payload: Record<string, unknown> };

const TYPES = new Set(["event", "identify", "performance"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Umami rejects names and tags that could start a spreadsheet formula. */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/**
 * Fields the server would accept but this package must never send: they identify a visitor or
 * override what the server derives itself.
 */
const FORBIDDEN_FIELDS = [
  "id",
  "ip",
  "userAgent",
  "timestamp",
  "browser",
  "os",
  "device",
  "link",
  "pixel",
];

const urlOrPath = (value: unknown) => {
  if (typeof value !== "string") return false;
  try {
    new URL(value, "https://localhost");
    return true;
  } catch {
    return false;
  }
};
const string = (value: unknown) => typeof value === "string";
const safeString = (value: unknown) => typeof value === "string" && !FORMULA_TRIGGER.test(value);
const record = (value: unknown) =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const metric = (limit: number) => (value: unknown) =>
  typeof value === "number" && value >= 0 && value <= limit;

/** Optional payload fields and the check Umami 3.4.0 applies to each. */
const FIELDS: Record<string, (value: unknown) => boolean> = {
  data: record,
  hostname: string,
  language: string,
  referrer: urlOrPath,
  screen: string,
  title: string,
  url: urlOrPath,
  name: safeString,
  tag: safeString,
  lcp: metric(60000),
  inp: metric(60000),
  cls: metric(100),
  fcp: metric(60000),
  ttfb: metric(60000),
};

/** Every reason Umami 3.4.0 would reject the request, or this package's contract forbids it. */
export function problems({ type, payload }: Sent): string[] {
  const found: string[] = [];
  if (!TYPES.has(type)) found.push(`type ${type}`);
  if (!string(payload.website) || !UUID.test(payload.website as string)) found.push("website");
  for (const key of FORBIDDEN_FIELDS) if (key in payload) found.push(`forbidden ${key}`);
  for (const key of Object.keys(payload)) {
    // The tracker also sends `duration`, the time open, which the server ignores.
    if (!(key in FIELDS) && key !== "website" && key !== "duration")
      found.push(`unexpected ${key}`);
  }
  for (const [key, valid] of Object.entries(FIELDS)) {
    if (payload[key] !== undefined && !valid(payload[key])) found.push(key);
  }
  return found;
}
