import {
  allowedEvent,
  type ChoiceField,
  DECLARED_EVENTS,
  type DeclaredEventName,
} from "./contract.ts";

/** Build-time configuration for one site. Everything here is public: it ships in the page. */
export interface AnalyticsConfig {
  /** The site's own Umami website ID; never share one between sites. */
  websiteId: string;
  /** Collector origin, such as `https://stats.example.com`, with no path. */
  collector: string;
  /** The one production hostname allowed to send, such as `example.com`. */
  hostname: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Validate a configuration, throwing with every problem listed. */
export function analyticsConfig(input: AnalyticsConfig): AnalyticsConfig {
  const problems: string[] = [];
  if (!UUID.test(input.websiteId)) problems.push("websiteId must be a UUID");
  let collector: URL | undefined;
  try {
    collector = new URL(input.collector);
  } catch {
    problems.push("collector must be a URL");
  }
  if (collector && (collector.protocol !== "https:" || collector.href !== `${collector.origin}/`)) {
    problems.push("collector must be an https origin with no path");
  }
  if (!HOSTNAME.test(input.hostname)) problems.push("hostname must be a lowercase domain name");
  if (problems.length) throw new Error(`Invalid analytics config: ${problems.join("; ")}`);
  return {
    websiteId: input.websiteId,
    collector: collector?.origin ?? "",
    hostname: input.hostname,
  };
}

/**
 * The element the browser module reads. Render it once per tracked page, anywhere in the document,
 * and load `@dougborg/site-analytics/analytics.js` as a module.
 */
export function configElement(config: AnalyticsConfig): string {
  const json = JSON.stringify(analyticsConfig(config)).replaceAll("<", "\\u003c");
  return `<script type="application/json" id="site-analytics">${json}</script>`;
}

/** The fields of a declared event, each limited to its allowed values. */
export type DeclaredEventData<N extends DeclaredEventName> = {
  -readonly [F in keyof (typeof DECLARED_EVENTS)[N]["fields"]]: (typeof DECLARED_EVENTS)[N]["fields"][F] extends ChoiceField
    ? (typeof DECLARED_EVENTS)[N]["fields"][F]["values"][number]
    : never;
};

/**
 * The attributes that declare an event on a control, such as
 * `data-analytics-event="theme-toggle" data-analytics-theme="dark"`. Throws for anything the
 * collection contract does not allow, so a site cannot build markup the module would drop.
 */
export function declaredEventAttributes<N extends DeclaredEventName>(
  name: N,
  data: DeclaredEventData<N>,
): string {
  const fields = data as Record<string, string>;
  if (!Object.hasOwn(DECLARED_EVENTS, name) || !allowedEvent(name, fields)) {
    throw new Error(`Not an allowed declared event: ${JSON.stringify({ name, data })}`);
  }
  const attributes = Object.entries(fields).map(
    ([key, value]) => `data-analytics-${key}="${value}"`,
  );
  return [`data-analytics-event="${name}"`, ...attributes].join(" ");
}
