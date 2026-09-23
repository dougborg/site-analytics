/**
 * The privacy notice for a site that uses this package. It describes exactly what the browser
 * module and the pinned Umami release collect, so it changes whenever either does.
 */
export interface NoticeOptions {
  /** The site's hostname, as visitors see it. */
  site: string;
  /** The person responsible for the data (the GDPR "controller"). */
  controller: { name: string; email: string };
  /** Collector origin, matching the analytics config. */
  collector: string;
  /** Where the analytics service runs, as a phrase: "on a server I run at home in Colorado". */
  hosting: string;
  /** The country the collector is in, as it reads in a sentence: "the United States". */
  country: string;
  /** A network provider that carries requests to the collector, if any. */
  network?: { name: string; privacyUrl: string };
  /** How long records are kept. The collector's operator must enforce it; Umami does not. */
  retentionDays: number;
  /** Date of the last change, `YYYY-MM-DD`. */
  updated: string;
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const PLAIN_EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

function formatDate(iso: string) {
  const date = new Date(`${iso}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || date.toISOString().slice(0, 10) !== iso) {
    throw new Error("updated must be a real YYYY-MM-DD date");
  }
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function httpsUrl(value: string, field: string) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`${field} must be an https URL`);
  return url;
}

function validate(options: NoticeOptions) {
  if (!PLAIN_EMAIL.test(options.controller.email)) {
    throw new Error("controller.email must be a plain email address");
  }
  const days = options.retentionDays;
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new Error("retentionDays must be a whole number of days from 1 to 3650");
  }
  for (const [field, value] of Object.entries({
    site: options.site,
    "controller.name": options.controller.name,
    hosting: options.hosting,
    country: options.country,
  })) {
    if (!value.trim()) throw new Error(`${field} must not be empty`);
  }
}

/** HTML for the notice body: sections with `<h2>` headings, for the page to wrap in its layout. */
export function privacyNotice(options: NoticeOptions): string {
  validate(options);
  const site = escapeHtml(options.site);
  const name = escapeHtml(options.controller.name);
  const email = escapeHtml(options.controller.email);
  const collector = escapeHtml(httpsUrl(options.collector, "collector").host);
  const network = options.network;
  const networkSentence = network
    ? ` Requests reach it through <a href="${escapeHtml(httpsUrl(network.privacyUrl, "network.privacyUrl").href)}">${escapeHtml(network.name)}</a>, which handles your IP address to route and protect the traffic.`
    : "";

  return `<p>${site} counts visits so I can see which pages people read, where readers come from, and whether pages load quickly. This page explains exactly what is collected and how to turn it off.</p>

<h2 id="collected">What is collected</h2>
<p>When a page loads with JavaScript on, it sends short records to an analytics service I run myself (<a href="https://umami.is/">Umami</a>, at ${collector}). They contain:</p>
<ul>
<li>the page address and title, and the address of the page that linked you here. Fragments and query parameters are removed, except the standard campaign tags <code>utm_source</code>, <code>utm_medium</code>, <code>utm_campaign</code>, <code>utm_content</code>, and <code>utm_term</code> on the page address, and anything that looks like an email address is replaced;</li>
<li>your screen size and browser language;</li>
<li>how quickly the page loaded and responded (the Web Vitals measures TTFB, FCP, LCP, CLS, and INP) and how long it had been open when they were measured;</li>
<li>how far down the page you scroll (25, 50, 75, and 100 percent) and how many seconds the page was visible;</li>
<li>clicks on links that leave the site, file downloads, and email or phone links, and on a few named controls such as a theme switch, with the choice made. Only the destination or the control's name is recorded: never the text of an email address, anything you type, or where on the page you clicked.</li>
</ul>
<p>Like any website, the service receives your IP address and browser user agent with each request. It combines them with a key kept on the server and the current month to derive an identifier that stays the same for that calendar month, so your visits to ${site} within a month can be grouped together, and a shorter one that groups a single visit. It also works out your approximate location (country, region, and city) and your browser, operating system, and device type. It stores those derived values but not your IP address or user agent.</p>

<h2 id="not-collected">What is not collected</h2>
<ul>
<li>No cookies, and nothing that identifies you by name, email, or account.</li>
<li>No advertising, profiling, or tracking on other people's websites.</li>
<li>Each of my sites gets a different identifier for you, and I do not combine them. They share one analytics server, so this is a promise about how I use the data, not a technical barrier.</li>
<li>Nothing is sold or shared with anyone for advertising.</li>
</ul>

<h2 id="choices">Your choices</h2>
<p>Nothing is collected if your browser sends <a href="https://globalprivacycontrol.org/">Global Privacy Control</a> or Do Not Track: the analytics script is not even loaded. With JavaScript off, nothing is collected, and blocking ${collector} works too.</p>
<div data-analytics-opt-out hidden>
<p data-analytics-status role="status"></p>
<p><button type="button">Stop counting my visits</button></p>
<p>This choice applies to this website in this browser, and is saved in your browser's local storage.</p>
</div>
<p>To honor that choice, the script reads that one local-storage entry before it loads; it writes it only when you use the button.</p>

<h2 id="basis">Why, and on what basis</h2>
<p>The purpose is to understand readership and keep the site fast and useful. Under the EU and UK GDPR, the legal basis is my legitimate interest in running the site (Article 6(1)(f)), which you can object to at any time with the choices above.</p>

<h2 id="processing">Where it goes and how long it stays</h2>
<p>The analytics service runs ${escapeHtml(options.hosting)}, in ${escapeHtml(options.country)}.${networkSentence} If you visit from another country, your records are transferred there. I delete records after ${options.retentionDays} days.</p>

<h2 id="rights">Your rights</h2>
<p>Depending on where you live, you can ask to see, correct, or delete data about you, or object to its use. Records are not tied to your name, so to find yours I would need to know roughly when you visited and which pages. Write to ${name} at <a href="mailto:${email}">${email}</a>. You can also complain to your local data protection authority.</p>

<p class="meta">Last updated <time datetime="${escapeHtml(options.updated)}">${formatDate(options.updated)}</time>.</p>
`;
}
