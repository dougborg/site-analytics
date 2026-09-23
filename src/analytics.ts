/**
 * Browser module: loads Umami's tracker only when the visitor has not opted out, sanitizes every
 * payload, and adds a fixed set of interaction events. It never blocks rendering, navigation, or
 * downloads, and the page works the same without it.
 */
import type { AnalyticsConfig } from "./config.ts";

type Payload = Record<string, unknown>;
type EventData = Record<string, string | number>;
type Umami = { track: (name: string, data?: EventData) => Promise<void> };
type AnalyticsWindow = Window & {
  umami?: Umami;
  doNotTrack?: string | null;
  siteAnalyticsBeforeSend?: (type: string, payload: Payload) => Payload | null;
};

const win = window as AnalyticsWindow;
/** Umami's documented opt-out key; its tracker also reads it. */
const OPT_OUT_KEY = "umami.disabled";
const SCROLL_DEPTHS = [25, 50, 75, 100] as const;
/** Static sites link files, not APIs, so these extensions mean a download. */
const DOWNLOAD_EXTENSIONS = new Set(["pdf", "docx", "md", "json", "zip", "csv", "txt", "epub"]);

function storage(): Storage | undefined {
  try {
    return win.localStorage;
  } catch {
    return undefined;
  }
}

function optedOut() {
  return storage()?.getItem(OPT_OUT_KEY) === "1";
}

/** Browser-level signals that mean "do not measure me". */
function privacySignal(): "gpc" | "dnt" | undefined {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  if (nav.globalPrivacyControl === true) return "gpc";
  const dnt = nav.doNotTrack ?? win.doNotTrack;
  if (dnt === "1" || dnt === "yes") return "dnt";
  return undefined;
}

function readConfig(): AnalyticsConfig | undefined {
  const element = document.getElementById("site-analytics");
  if (!element?.textContent) return undefined;
  try {
    return JSON.parse(element.textContent) as AnalyticsConfig;
  } catch {
    return undefined;
  }
}

/** Keep campaign tags, drop every other query parameter and the fragment. */
function cleanUrl(raw: unknown, keepCampaign: boolean): unknown {
  if (typeof raw !== "string" || raw === "") return raw;
  try {
    const url = new URL(raw, location.href);
    const params = [...url.searchParams].filter(([key]) => keepCampaign && key.startsWith("utm_"));
    url.search = new URLSearchParams(params).toString();
    url.hash = "";
    // Umami sends url absolute but strips the origin from a same-site referrer; keep each shape.
    return raw.startsWith("/") ? url.pathname + url.search : url.toString();
  } catch {
    return undefined;
  }
}

function beforeSend(type: string, payload: Payload): Payload | null {
  if (type === "identify" || optedOut() || privacySignal()) return null;
  const { id: _id, ...rest } = payload;
  return {
    ...rest,
    url: cleanUrl(payload.url, true),
    referrer: cleanUrl(payload.referrer, false),
  };
}

function blocked(config: AnalyticsConfig) {
  return (
    location.hostname !== config.hostname ||
    navigator.webdriver === true ||
    win.top !== win.self ||
    optedOut() ||
    privacySignal() !== undefined
  );
}

/* Sending: events wait for the tracker, and are dropped if it never loads. */

const queue: [string, EventData][] = [];
let ready = false;

function track(name: string, data: EventData) {
  if (ready && win.umami) void win.umami.track(name, data).catch(() => {});
  else queue.push([name, data]);
}

function loadTracker(config: AnalyticsConfig) {
  win.siteAnalyticsBeforeSend = beforeSend;
  const script = document.createElement("script");
  script.defer = true;
  script.src = `${config.collector}/script.js`;
  const attributes = {
    "website-id": config.websiteId,
    "host-url": config.collector,
    domains: config.hostname,
    "do-not-track": "true",
    "exclude-hash": "true",
    performance: "true",
    "before-send": "siteAnalyticsBeforeSend",
  };
  for (const [name, value] of Object.entries(attributes))
    script.setAttribute(`data-${name}`, value);
  script.addEventListener("load", () => {
    ready = true;
    for (const [name, data] of queue.splice(0)) track(name, data);
  });
  script.addEventListener("error", () => queue.splice(0));
  document.head.append(script);
}

/* Interaction events */

/** `data-analytics-event="name"` with `data-analytics-<key>="value"` properties. */
function declaredEvent(element: Element): [string, EventData] | undefined {
  const source = element.closest("[data-analytics-event]");
  const name = source?.getAttribute("data-analytics-event");
  if (!source || !name) return undefined;
  const data: EventData = {};
  for (const attribute of source.getAttributeNames()) {
    const key = attribute.match(/^data-analytics-([a-z0-9-]+)$/)?.[1];
    if (key && key !== "event") data[key] = source.getAttribute(attribute) ?? "";
  }
  return [name, data];
}

function linkEvent(link: HTMLAnchorElement): [string, EventData] | undefined {
  let url: URL;
  try {
    url = new URL(link.href, location.href);
  } catch {
    return undefined;
  }
  if (url.protocol === "mailto:") return ["contact-click", { method: "email" }];
  if (url.protocol === "tel:") return ["contact-click", { method: "phone" }];
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  const file = url.pathname.split("/").pop() ?? "";
  const extension = file.includes(".") ? file.split(".").pop()?.toLowerCase() : undefined;
  if (link.hasAttribute("download") || (extension && DOWNLOAD_EXTENSIONS.has(extension))) {
    return ["download-click", { format: extension ?? "file", file }];
  }
  if (url.origin !== location.origin) {
    return ["outbound-click", { url: url.origin + url.pathname }];
  }
  return undefined;
}

function onClick(event: MouseEvent) {
  if (event.type === "auxclick" && event.button !== 1) return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const link = target.closest("a[href]");
  const found = declaredEvent(target) ?? (link && linkEvent(link as HTMLAnchorElement));
  if (found) track(...found);
}

function watchScroll() {
  const reached = new Set<number>();
  let pending = false;
  const measure = () => {
    pending = false;
    const { scrollHeight } = document.documentElement;
    // A page that barely scrolls says nothing about reading depth.
    if (scrollHeight <= innerHeight * 1.2) return;
    const percent = ((scrollY + innerHeight) / scrollHeight) * 100;
    for (const depth of SCROLL_DEPTHS) {
      if (percent >= Math.min(depth, 98) && !reached.has(depth)) {
        reached.add(depth);
        track("scroll-depth", { depth });
      }
    }
  };
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

/** One event per page view with the seconds the page was visible, sent when the visitor leaves. */
function watchEngagement() {
  let visibleSince = document.visibilityState === "visible" ? performance.now() : undefined;
  let total = 0;
  let sent = false;
  const pause = () => {
    if (visibleSince !== undefined) total += performance.now() - visibleSince;
    visibleSince = undefined;
  };
  const leave = () => {
    pause();
    const seconds = Math.min(Math.round(total / 1000), 3600);
    if (!sent && seconds > 0) {
      sent = true;
      track("engaged-time", { seconds });
    }
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") visibleSince = performance.now();
    else leave();
  });
  addEventListener("pagehide", leave);
}

/* The opt-out control on a privacy page works whether or not tracking is running. */

function describeState(status: Element | null, button: HTMLButtonElement) {
  const signal = privacySignal();
  const off = optedOut();
  button.textContent = off ? "Resume counting my visits" : "Stop counting my visits";
  if (!status) return;
  if (signal) {
    const name = signal === "gpc" ? "Global Privacy Control" : "Do Not Track";
    status.textContent = `Your browser sends ${name}, so this site does not count your visits.`;
  } else {
    status.textContent = off
      ? "This site does not count your visits in this browser."
      : "This site counts your visits in this browser.";
  }
}

function wireOptOut() {
  for (const control of document.querySelectorAll<HTMLElement>("[data-analytics-opt-out]")) {
    const button = control.querySelector("button");
    const status = control.querySelector("[data-analytics-status]");
    if (!button) continue;
    button.addEventListener("click", () => {
      const store = storage();
      if (optedOut()) store?.removeItem(OPT_OUT_KEY);
      else store?.setItem(OPT_OUT_KEY, "1");
      describeState(status, button);
    });
    describeState(status, button);
    control.hidden = false;
  }
}

function start() {
  wireOptOut();
  const config = readConfig();
  if (!config || blocked(config)) return;
  loadTracker(config);
  document.addEventListener("click", onClick, true);
  document.addEventListener("auxclick", onClick, true);
  watchScroll();
  watchEngagement();
}

start();
