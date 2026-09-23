# @dougborg/site-analytics

Privacy-respecting [Umami](https://umami.is/) analytics for static sites.
It loads Umami's own tracker only when the visitor has not opted out, cleans every payload, adds a fixed set of interaction events, and ships the privacy notice that describes exactly that.

It is built for [resume.dougborg.org](https://resume.dougborg.org/) and [dougborg.org](https://dougborg.org/), both counted by a self-hosted Umami at `stats.dougborg.net`, but it works with any Umami 3.x collector.

## What it collects

| Event | When | Data |
| --- | --- | --- |
| Page view | Each page load (Umami) | Path with only `utm_*` parameters kept, title, referrer without query or fragment, screen, language |
| `performance` | Page load (Umami) | Web Vitals: TTFB, FCP, LCP, CLS, INP |
| `scroll-depth` | First time the visitor reaches 25, 50, 75, or 100 percent of a page that scrolls | `depth` |
| `engaged-time` | Once, when the visitor leaves or hides the page | `seconds` visible, at most 3600 |
| `outbound-click` | A click or middle click on a link to another origin | `url`: origin and path only |
| `download-click` | A link with `download`, or to a `pdf`, `docx`, `md`, `json`, `zip`, `csv`, `txt`, or `epub` file | `format`, `file` name |
| `contact-click` | A `mailto:` or `tel:` link | `method`: `email` or `phone`, never the address |
| Declared | A click inside `data-analytics-event="name"` | Each `data-analytics-<key>` attribute |

Umami's server also derives a rotating visit ID, coarse location, and browser, OS, and device type from the IP address and user agent; it stores those derived values but not the raw IP or user agent.

Nothing loads, and nothing is sent, when any of these hold:

- the browser sends Global Privacy Control or Do Not Track;
- the visitor opted out on the site's privacy page (Umami's `umami.disabled` local-storage flag);
- the hostname is not the configured production hostname;
- the page is framed or the browser reports automation (`navigator.webdriver`).

It never calls `umami.identify`, drops any identify payload, and strips any distinct ID.
It sets no cookies.
Clicks are never delayed: events go out with keepalive requests, and anything queued before the tracker loads is dropped if it never does.

## Use

Install it, then render the config element and load the module on every tracked page:

```sh
pnpm add @dougborg/site-analytics
```

```ts
import { configElement } from "@dougborg/site-analytics";

const tag = configElement({
  websiteId: "00000000-0000-4000-8000-000000000000", // one Umami website per site
  collector: "https://stats.example.com",
  hostname: "example.com",
});
```

```html
<!-- the output of configElement(), anywhere in the page -->
<script type="application/json" id="site-analytics">{…}</script>
<script type="module" src="/assets/analytics.js"></script>
```

Copy `@dougborg/site-analytics/analytics.js` to your assets, or let a bundler import it; in Astro, `<script>import "@dougborg/site-analytics/analytics.js";</script>` works.
`configElement` validates the config and throws on a bad website ID, a non-HTTPS collector, or a malformed hostname.
Omit the config element to turn tracking off while keeping the opt-out control working.

### Privacy notice

Every tracked site needs a privacy page that links from each tracked page and loads the module, so its opt-out button works:

```ts
import { privacyNotice } from "@dougborg/site-analytics";

const html = privacyNotice({
  site: "example.com",
  controller: { name: "Your Name", email: "you@example.com" },
  collector: "https://stats.example.com",
  hosting: "on a server I run at home in Colorado, USA",
  network: { name: "Cloudflare", privacyUrl: "https://www.cloudflare.com/privacypolicy/" },
  retentionDays: 90,
  updated: "2026-09-22",
});
```

It returns the notice body as HTML with `<h2>` sections for the page's own layout.
The opt-out control is hidden until the module runs, because it cannot work without JavaScript.
The notice describes this package's events, so a release that changes what is collected also changes the notice, and consumers should republish their privacy page with a new `updated` date.
It is written to meet the GDPR's transparency duties for a personal site, but it is not legal advice.

## Develop

```sh
pnpm install --frozen-lockfile
pnpm build          # dist/, with type declarations
pnpm check          # Biome, rumdl, tsc, Knip, node --test
pnpm test:browser   # Playwright against a fixture page and a stub tracker, port 4175
```

The stub in `test/fixture/umami-stub.js` follows the Umami 3.4.0 tracker's contract: data attributes on its script element, the named `before-send` hook, an absolute `url` and a same-origin `referrer` without its origin, and `POST /api/send` with `{ type, payload }`.
Recheck that contract against the tracker source when the collector upgrades.

## Releases

Versions follow [Conventional Commits](https://www.conventionalcommits.org/) through release-please.
Adding an event, a payload field, or anything else that widens collection is `feat` and must update the notice in the same change; removing or renaming an export is `feat!`.
Merging the release PR tags the version, and `.github/workflows/release.yml` stages it on npm as a trusted publisher with provenance.
The owner approves each staged version with 2FA before it goes live.

## License

[MIT](LICENSE)
