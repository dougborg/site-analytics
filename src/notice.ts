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
  /** Where the analytics service runs, as a phrase: "on a server I run at home in Colorado, USA". */
  hosting: string;
  /** A network provider that carries requests to the collector, if any. */
  network?: { name: string; privacyUrl: string };
  retentionDays: number;
  /** Date of the last change, `YYYY-MM-DD`. */
  updated: string;
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function formatDate(iso: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error("updated must be YYYY-MM-DD");
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** HTML for the notice body: sections with `<h2>` headings, for the page to wrap in its layout. */
export function privacyNotice(options: NoticeOptions): string {
  const site = escapeHtml(options.site);
  const name = escapeHtml(options.controller.name);
  const email = escapeHtml(options.controller.email);
  const collector = escapeHtml(new URL(options.collector).host);
  const network = options.network;
  const days = Math.trunc(options.retentionDays);
  if (!(days > 0)) throw new Error("retentionDays must be a positive number");
  const networkSentence = network
    ? ` Requests reach it through <a href="${escapeHtml(network.privacyUrl)}">${escapeHtml(network.name)}</a>, which handles your IP address to route and protect the traffic.`
    : "";

  return `<p>${site} counts visits so I can see which pages people read, where readers come from, and whether pages load quickly. This page explains exactly what is collected and how to turn it off.</p>

<h2 id="collected">What is collected</h2>
<p>When a page loads with JavaScript on, it sends a short record to an analytics service I run myself (<a href="https://umami.is/">Umami</a>, at ${collector}). The record contains:</p>
<ul>
<li>the page address, with the fragment and any query parameters removed except campaign tags that start with <code>utm_</code>;</li>
<li>the page title, and the address of the page that linked you here, without its query string;</li>
<li>your screen size, browser language, and how quickly the page loaded and responded (the Web Vitals measures TTFB, FCP, LCP, CLS, and INP);</li>
<li>how far down the page you scroll (25, 50, 75, and 100 percent) and how many seconds the page was visible;</li>
<li>clicks on links that leave the site, file downloads, and email or phone links. Only the destination is recorded: never the text of an email address, anything you type, or where on the page you clicked.</li>
</ul>
<p>Like any website, the service receives your IP address and browser user agent with each request. It uses them, with a secret value that changes every month, to derive a visit identifier, your approximate location (country, region, and city), and your browser, operating system, and device type. It stores those derived values but not your IP address or user agent.</p>

<h2 id="not-collected">What is not collected</h2>
<ul>
<li>No cookies, and nothing that identifies you by name, email, or account.</li>
<li>No advertising, profiling, or tracking across other websites. Each of my sites is counted separately, so visits are not linked between them.</li>
<li>Nothing is sold or shared with anyone for advertising.</li>
</ul>

<h2 id="choices">Your choices</h2>
<p>Nothing is collected if your browser sends <a href="https://globalprivacycontrol.org/">Global Privacy Control</a> or Do Not Track: the analytics script is not even loaded. With JavaScript off, nothing is collected, and blocking ${collector} works too.</p>
<div data-analytics-opt-out hidden>
<p data-analytics-status role="status"></p>
<p><button type="button">Stop counting my visits</button></p>
<p>This choice applies to ${site} in this browser. It is saved in your browser's local storage, which is the only thing this site stores on your device.</p>
</div>

<h2 id="basis">Why, and on what basis</h2>
<p>The purpose is to understand readership and keep the site fast and useful. Under the EU and UK GDPR, the legal basis is my legitimate interest in running the site (Article 6(1)(f)), which you can object to at any time with the choices above.</p>

<h2 id="processing">Where it goes and how long it stays</h2>
<p>The analytics service runs ${escapeHtml(options.hosting)}.${networkSentence} Records are deleted after ${days} days. The service is in the United States, so if you visit from elsewhere, the record is transferred there.</p>

<h2 id="rights">Your rights</h2>
<p>Depending on where you live, you can ask to see, correct, or delete data about you, or object to its use. Records are not tied to your name, so to find yours I would need to know roughly when you visited and which pages. Write to ${name} at <a href="mailto:${email}">${email}</a>. You can also complain to your local data protection authority.</p>

<p class="meta">Last updated <time datetime="${escapeHtml(options.updated)}">${formatDate(options.updated)}</time>.</p>
`;
}
