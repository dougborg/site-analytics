/**
 * Browser module: loads Umami's tracker only when the visitor has not opted out, rebuilds every
 * payload from the page itself, and sends only the events in the collection contract. It never
 * blocks rendering, navigation, or downloads, and the page works the same without it. The build
 * inlines the contract, so the published file is self-contained and sites can copy it without a
 * bundler.
 */
import type { ValidAnalyticsConfig } from "./config.ts";
import {
  allowedEvent,
  DECLARED_EVENTS,
  DOWNLOAD_FORMATS,
  declaredEventNames,
  type EventName,
  METRIC_FIELDS,
  type PAYLOAD_FIELDS,
  SCROLL_DEPTHS,
  siteEvents,
} from "./contract.ts";

type Payload = Record<string, unknown>;
/** What reaches the collector: only the contract's payload fields. */
type Outgoing = Partial<Record<(typeof PAYLOAD_FIELDS)[number], unknown>>;
type EventData = Record<string, string | number>;
type Umami = { track: (name: string, data?: EventData) => Promise<void> };
type AnalyticsWindow = Window & {
  umami?: Umami;
  doNotTrack?: string | null;
  siteAnalyticsStarted?: boolean;
};
type State = "off" | "blocked" | "loading" | "loaded" | "failed";

const win = window as AnalyticsWindow;
/** Umami's documented opt-out key; its tracker also reads it. */
const OPT_OUT_KEY = "umami.disabled";
const HOOK = "siteAnalyticsBeforeSend";
const DOWNLOADS = new Set<string>(DOWNLOAD_FORMATS);
/** Umami parses only these; anything else under `utm_` is stored but useless. */
const CAMPAIGN_KEYS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Bounded parts keep matching linear, so long hostile strings cannot stall the page. */
const EMAIL = /[^\s/?#&=:@]{1,64}@(?:[^\s/?#&=:@.]{1,63}\.){1,8}[A-Za-z]{2,24}(?![A-Za-z0-9-])/g;
const MAX_TEXT = 2000;

/* Privacy state */

function storage(): Storage | undefined {
  try {
    return win.localStorage;
  } catch {
    return undefined;
  }
}

function optedOut() {
  try {
    return storage()?.getItem(OPT_OUT_KEY) === "1";
  } catch {
    return false;
  }
}

/** Browser-level signals that mean "do not measure me". */
function privacySignal(): "gpc" | "dnt" | undefined {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  if (nav.globalPrivacyControl === true) return "gpc";
  const dnt = nav.doNotTrack ?? win.doNotTrack;
  if (dnt === "1" || dnt === "yes") return "dnt";
  return undefined;
}

/* Configuration: rendered at build time, but revalidated here so page markup cannot redirect it. */

function isCollector(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value && !url.username && !url.password;
  } catch {
    return false;
  }
}

function readConfig(): ValidAnalyticsConfig | undefined {
  const elements = document.querySelectorAll("#site-analytics");
  const element = elements[0];
  const valid =
    elements.length === 1 &&
    element instanceof HTMLScriptElement &&
    element.type === "application/json";
  if (!valid) return undefined;
  try {
    const parsed = JSON.parse(element.textContent ?? "") as Payload;
    const { websiteId, collector, hostname } = parsed;
    if (typeof websiteId !== "string" || !UUID.test(websiteId) || !isCollector(collector)) {
      return undefined;
    }
    // A config without the list predates it and declares nothing; an invalid list is refused.
    const declaredEvents = declaredEventNames(parsed.declaredEvents ?? []);
    if (typeof hostname !== "string" || !declaredEvents) return undefined;
    return { websiteId, collector, hostname, declaredEvents };
  } catch {
    return undefined;
  }
}

function blocked(config: ValidAnalyticsConfig) {
  return (
    location.protocol !== "https:" ||
    // host includes any port, so the production name on another port does not count.
    location.host !== config.hostname ||
    navigator.webdriver === true ||
    win.top !== win.self ||
    optedOut() ||
    privacySignal() !== undefined
  );
}

/* Payload cleaning */

const redact = (text: string) => text.slice(0, MAX_TEXT).replace(EMAIL, "[email]");

/** Fully decode a path segment, so double-encoded addresses are seen too. */
function decoded(segment: string) {
  let text = segment;
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(text);
      if (next === text) break;
      text = next;
    } catch {
      break;
    }
  }
  return text;
}

/** Replace only segments that hold an email address; every other segment keeps its encoding. */
function redactPath(path: string) {
  return path
    .slice(0, MAX_TEXT)
    .split("/")
    .map((segment) => {
      EMAIL.lastIndex = 0;
      return EMAIL.test(decoded(segment)) ? "[email]" : segment;
    })
    .join("/");
}

/** Keep only standard campaign tags, drop the fragment, and redact email-like text. */
function cleanUrl(raw: string, keepCampaign: boolean): string | undefined {
  if (raw === "") return raw;
  try {
    const url = new URL(raw, location.href);
    const params = [...url.searchParams].filter(
      ([key, value]) =>
        keepCampaign &&
        CAMPAIGN_KEYS.has(key) &&
        value.length <= 100 &&
        !decoded(value).includes("@"),
    );
    url.search = new URLSearchParams(params).toString();
    url.hash = "";
    url.pathname = redactPath(url.pathname);
    // Umami sends url absolute but strips the origin from a same-site referrer; keep each shape.
    return raw.startsWith("/") ? url.pathname + url.search : url.toString();
  } catch {
    return undefined;
  }
}

/** Umami's shape for a referrer: a same-origin address loses its origin. */
function sameSitePath(url: string) {
  const { origin } = location;
  return url === origin || url.startsWith(`${origin}/`) ? url.slice(origin.length) || "/" : url;
}

/* Payloads: built from the page itself, never from what a caller put in them. */

type Page = { url?: string; referrer?: string; title: string };

/** The website ID this module configured Umami with; any other payload is not ours. */
let websiteId: string | undefined;
/**
 * The events this site can send: the built-in ones plus its `declaredEvents`, exactly the events
 * its privacy notice lists. Empty until the config is read, so nothing is sent before then.
 */
let sendable = new Set<string>();
/** The page the last page view described; events and Web Vitals belong to it. */
let currentPage: Page | undefined;
/**
 * The event this module is sending, set only during its own `umami.track` call. Umami runs the
 * hook synchronously inside that call, so any other named event is dropped, such as one from a
 * `data-umami-event` attribute or a page script.
 */
let outgoing: [EventName, EventData] | undefined;

/**
 * A page view describes the current address. Like Umami's tracker, its referrer is the linking
 * page on the first view and the previous page view's address after a history navigation; a
 * repeated view of the same address keeps the referrer it had.
 */
function viewPage(): Page {
  const url = cleanUrl(location.href, true);
  let referrer: string | undefined;
  if (!currentPage) referrer = cleanUrl(sameSitePath(document.referrer), false);
  else if (url === currentPage.url) referrer = currentPage.referrer;
  else referrer = currentPage.url && cleanUrl(sameSitePath(currentPage.url), false);
  // Umami's server decodes titles, so an encoded address must be caught here too.
  currentPage = { url, referrer, title: redact(decoded(document.title)) };
  return currentPage;
}

function pageFields({ url, referrer, title }: Page): Outgoing {
  return {
    website: websiteId,
    hostname: location.hostname,
    screen: `${screen.width}x${screen.height}`,
    language: navigator.language,
    url,
    referrer,
    title,
  };
}

function metrics(payload: Payload): Outgoing {
  const clean: Outgoing = {};
  for (const key of METRIC_FIELDS) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) clean[key] = value;
  }
  return clean;
}

/**
 * Umami's `before-send` hook. It takes from the tracker's payload only what the page cannot
 * say itself: whether it is a page view, and the Web Vitals it measured.
 */
function beforeSend(type: string, payload: Payload): Outgoing | null {
  if (optedOut() || privacySignal() || !websiteId || payload.website !== websiteId) return null;
  if (type === "performance")
    return { ...pageFields(currentPage ?? viewPage()), ...metrics(payload) };
  // Anything else, including identify, is not something this module sends.
  if (type !== "event") return null;
  if (payload.name === undefined) return pageFields(viewPage());
  if (!outgoing || payload.name !== outgoing[0]) return null;
  const [name, data] = outgoing;
  return { ...pageFields(currentPage ?? viewPage()), name, data };
}

/* Sending: events wait for the tracker, and are dropped if it never loads. */

const queue: [EventName, EventData][] = [];
let state: State = "off";
/** Umami's track function as loaded, so a page script that replaces it cannot borrow our flag. */
let umamiTrack: Umami["track"] | undefined;

function setState(next: State) {
  state = next;
  document.getElementById("site-analytics")?.setAttribute("data-state", next);
}

/**
 * Send one event, or drop it if the site did not declare it or the collection contract does not
 * allow exactly this data.
 */
function track(name: EventName, data: EventData) {
  if (!sendable.has(name)) return;
  const clean: EventData = {};
  for (const [key, value] of Object.entries(data)) {
    clean[key] = typeof value === "string" ? redact(value).slice(0, 200) : value;
  }
  if (!allowedEvent(name, clean)) return;
  if (state === "loaded" && umamiTrack) {
    outgoing = [name, clean];
    try {
      void umamiTrack(name, clean).catch(() => {});
    } finally {
      outgoing = undefined;
    }
  } else if (state === "loading" && queue.length < 50) queue.push([name, clean]);
}

function loadTracker(config: ValidAnalyticsConfig) {
  // Umami looks the hook up by name on every send, so it must not be replaceable.
  try {
    Object.defineProperty(win, HOOK, { value: beforeSend, writable: false, configurable: false });
  } catch {
    setState("blocked");
    return false;
  }
  websiteId = config.websiteId;
  sendable = new Set(siteEvents(config.declaredEvents));
  const script = document.createElement("script");
  script.defer = true;
  script.src = `${config.collector}/script.js`;
  const attributes = {
    "website-id": config.websiteId,
    "host-url": config.collector,
    domains: location.hostname,
    "do-not-track": "true",
    "exclude-hash": "true",
    performance: "true",
    "before-send": HOOK,
  };
  for (const [name, value] of Object.entries(attributes))
    script.setAttribute(`data-${name}`, value);
  script.addEventListener("load", () => {
    const umamiTrackFn = win.umami?.track;
    if (typeof umamiTrackFn !== "function") {
      setState("failed");
      queue.length = 0;
      return;
    }
    umamiTrack = umamiTrackFn.bind(win.umami);
    setState("loaded");
    for (const [name, data] of queue.splice(0)) track(name, data);
  });
  script.addEventListener("error", () => {
    setState("failed");
    queue.length = 0;
  });
  setState("loading");
  document.head.append(script);
  return true;
}

/* Interaction events */

/**
 * `data-analytics-event="name"` with one `data-analytics-<field>="value"` per field. Only events the
 * site's config declares, with exactly their fields and allowed values, count; anything else is
 * ignored, so a link inside it still counts as the link it is.
 */
function declaredEvent(element: Element): [EventName, EventData] | undefined {
  const source = element.closest("[data-analytics-event]");
  const name = source?.getAttribute("data-analytics-event");
  if (!source || !name || !Object.hasOwn(DECLARED_EVENTS, name) || !sendable.has(name))
    return undefined;
  const data: EventData = {};
  for (const attribute of source.getAttributeNames()) {
    const key = attribute.match(/^data-analytics-([a-z0-9-]+)$/)?.[1];
    if (key && key !== "event") data[key] = source.getAttribute(attribute) ?? "";
  }
  return allowedEvent(name, data) ? [name as EventName, data] : undefined;
}

function linkUrl(link: Element): URL | undefined {
  const href = link.getAttribute("href") ?? link.getAttribute("xlink:href");
  try {
    return href ? new URL(href, document.baseURI) : undefined;
  } catch {
    return undefined;
  }
}

function linkEvent(link: Element): [EventName, EventData] | undefined {
  const url = linkUrl(link);
  if (!url) return undefined;
  if (url.protocol === "mailto:") return ["contact-click", { method: "email" }];
  if (url.protocol === "tel:") return ["contact-click", { method: "phone" }];
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  const sameOrigin = url.origin === location.origin;
  const file = url.pathname.split("/").pop() ?? "";
  const extension = file.includes(".") ? file.split(".").pop()?.toLowerCase() : undefined;
  const format = extension !== undefined && DOWNLOADS.has(extension) ? extension : undefined;
  if (link.hasAttribute("download") || (sameOrigin && format)) {
    return ["download-click", { format: format ?? "file", file: redactPath(file) }];
  }
  if (!sameOrigin) return ["outbound-click", { url: url.origin + redactPath(url.pathname) }];
  return undefined;
}

function onClick(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const link = target.closest("a, area");
  // A middle click opens a link in a new tab; on anything else it does nothing.
  if (event.type === "auxclick" && (event.button !== 1 || !link)) return;
  const found = declaredEvent(target) ?? (link ? linkEvent(link) : undefined);
  if (found) track(...found);
}

/**
 * Depths the visitor scrolls past themselves. The depth in view when they first scroll is the
 * baseline, so arriving at an anchor and scrolling back up reports nothing.
 */
function watchScroll() {
  const reached = new Set<number>();
  let baseline: number | undefined;
  let pending = false;
  const percent = () => {
    const { scrollHeight } = document.documentElement;
    return ((scrollY + innerHeight) / scrollHeight) * 100;
  };
  const measure = () => {
    pending = false;
    // A page that barely scrolls says nothing about reading depth.
    if (baseline === undefined || document.documentElement.scrollHeight <= innerHeight * 1.2) {
      return;
    }
    const now = percent();
    for (const depth of SCROLL_DEPTHS) {
      if (depth > baseline && now >= Math.min(depth, 98) && !reached.has(depth)) {
        reached.add(depth);
        track("scroll-depth", { depth });
      }
    }
  };
  const engage = () => {
    baseline ??= percent();
  };
  for (const type of ["wheel", "touchstart", "keydown", "pointerdown"]) {
    addEventListener(type, engage, { passive: true, capture: true });
  }
  addEventListener(
    "scroll",
    () => {
      if (!pending) {
        pending = true;
        requestAnimationFrame(measure);
      }
    },
    { passive: true },
  );
}

/** Visible seconds, reported each time the page is hidden or left, so the sum per page is its total. */
function watchEngagement() {
  let visibleSince = document.visibilityState === "visible" ? performance.now() : undefined;
  let unreported = 0;
  const report = () => {
    if (visibleSince !== undefined) unreported += performance.now() - visibleSince;
    visibleSince = undefined;
    const seconds = Math.min(Math.round(unreported / 1000), 3600);
    if (seconds > 0) {
      unreported = 0;
      track("engaged-time", { seconds });
    }
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") visibleSince ??= performance.now();
    else report();
  });
  addEventListener("pagehide", report);
  addEventListener("pageshow", (event) => {
    if (event.persisted && document.visibilityState === "visible") visibleSince = performance.now();
  });
}

/* The opt-out control on a privacy page works whether or not tracking is running. */

/** Whether the opt-out can be read here at all; this never writes to storage. */
function storageReadable() {
  try {
    storage()?.getItem(OPT_OUT_KEY);
    return storage() !== undefined;
  } catch {
    return false;
  }
}

const UNSAVED =
  "Your browser did not let this site save that choice. Turn on Global Privacy Control or block the analytics service instead.";

function statusText(readable: boolean): string {
  const signal = privacySignal();
  if (signal) {
    const name = signal === "gpc" ? "Global Privacy Control" : "Do Not Track";
    return `Your browser sends ${name}, so this site does not count your visits.`;
  }
  if (!readable) {
    return "Your browser blocks site storage, so this choice cannot be saved here. Turn on Global Privacy Control or block the analytics service instead.";
  }
  return optedOut()
    ? "This site does not count your visits in this browser."
    : "This site counts your visits in this browser.";
}

function describeControls(message?: string) {
  const readable = storageReadable();
  for (const control of document.querySelectorAll<HTMLElement>("[data-analytics-opt-out]")) {
    const button = control.querySelector("button");
    const status = control.querySelector("[data-analytics-status]");
    if (button) {
      button.disabled = !readable;
      button.textContent = optedOut() ? "Resume counting my visits" : "Stop counting my visits";
    }
    if (status) status.textContent = message ?? statusText(readable);
    control.hidden = false;
  }
}

function toggleOptOut() {
  try {
    if (optedOut()) storage()?.removeItem(OPT_OUT_KEY);
    else storage()?.setItem(OPT_OUT_KEY, "1");
    describeControls();
  } catch {
    // A full storage quota, for example: nothing changed, and the visitor should know.
    describeControls(UNSAVED);
  }
}

function wireOptOut() {
  for (const control of document.querySelectorAll("[data-analytics-opt-out] button")) {
    control.addEventListener("click", toggleOptOut);
  }
  addEventListener("storage", (event) => {
    if (event.key === OPT_OUT_KEY) describeControls();
  });
  describeControls();
}

function startTracking() {
  const config = readConfig();
  if (!config) return;
  if (blocked(config)) {
    setState("blocked");
    return;
  }
  if (!loadTracker(config)) return;
  document.addEventListener("click", onClick, true);
  document.addEventListener("auxclick", onClick, true);
  watchScroll();
  watchEngagement();
}

function start() {
  // A second copy of the module on the same page must not double every event.
  if (win.siteAnalyticsStarted) return;
  Object.defineProperty(win, "siteAnalyticsStarted", { value: true });
  wireOptOut();
  // A prerendered page may never be seen; count it only once it is shown.
  const doc = document as Document & { prerendering?: boolean };
  if (doc.prerendering) {
    document.addEventListener("prerenderingchange", startTracking, { once: true });
  } else {
    startTracking();
  }
}

start();
