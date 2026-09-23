# @dougborg/site-analytics

Privacy-respecting [Umami](https://umami.is/) analytics for static sites.
It loads Umami's own tracker only when the visitor has not opted out, cleans every payload, adds a fixed set of interaction events, and ships the privacy notice that describes exactly that.

It is built for [resume.dougborg.org](https://resume.dougborg.org/) and [dougborg.org](https://dougborg.org/), both counted by a self-hosted Umami at `stats.dougborg.net`, but it works with any Umami 3.x collector.

## What it collects

| Event | When | Data |
| --- | --- | --- |
| Page view | Each page load and history navigation (Umami) | URL keeping only `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, and `utm_term`; title; referrer without query or fragment; screen; language |
| `performance` | Page load (Umami) | Web Vitals (TTFB, FCP, LCP, CLS, INP) and how long the page had been open |
| `scroll-depth` | The first time the visitor, after scrolling themselves, reaches 25, 50, 75, or 100 percent of a page that scrolls | `depth` |
| `engaged-time` | Each time the page is hidden or left | `seconds` visible since the last report, at most 3600; their sum is the page's total |
| `outbound-click` | A click or middle click on a link or image-map area to another origin | `url`: origin and path only |
| `download-click` | A link with `download`, or a same-origin link to a `pdf`, `docx`, `md`, `json`, `zip`, `csv`, `txt`, or `epub` file | `format`, `file` name |
| `contact-click` | A `mailto:` or `tel:` link | `method`: `email` or `phone`, never the address |
| Declared | A click inside `data-analytics-event="name"` | Each `data-analytics-<key>` attribute, at most 200 characters |

Anything that looks like an email address in a URL path, title, or event value becomes `[email]`, and campaign values containing `@` or longer than 100 characters are dropped.
Umami's own `data-umami-event` attributes are ignored: those events are dropped before sending, so do not use them.

Umami's server combines the IP address and user agent with a server key and the current month to derive a session ID that is stable for the calendar month, plus an hourly visit ID, and derives coarse location and browser, OS, and device type; it stores those derived values but not the raw IP or user agent.
Session IDs differ between website IDs, but one server holds them all.

Nothing loads, and nothing is sent, when any of these hold:

- the browser sends Global Privacy Control or Do Not Track;
- the visitor opted out on the site's privacy page (Umami's `umami.disabled` local-storage flag);
- the page is not served over HTTPS from the configured production hostname;
- the page is framed, prerendered and not yet shown, or the browser reports automation (`navigator.webdriver`);
- the config element is missing, duplicated, not a `script type="application/json"`, or invalid (the module rechecks the website ID and the HTTPS collector origin, so page markup cannot redirect it).

It never calls `umami.identify`, drops any identify payload, and strips any distinct ID.
It sets no cookies, and it reads local storage only for the opt-out flag.
Clicks are never delayed: events go out with keepalive requests, at most 50 events wait for the tracker to load, and they are dropped if it never does.
The `before-send` hook is non-writable, so other scripts cannot remove the cleaning, and loading the module twice starts it once.
The config element's `data-state` attribute reports `blocked`, `loading`, `loaded`, or `failed` for debugging.

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

With a Content Security Policy, allow the collector in both `script-src` and `connect-src`, and allow the module itself (Astro may inline it, which needs a hash or nonce).

### Privacy notice

Every tracked site needs a privacy page that links from each tracked page and loads the module, so its opt-out button works:

```ts
import { privacyNotice } from "@dougborg/site-analytics";

const html = privacyNotice({
  site: "example.com",
  controller: { name: "Your Name", email: "you@example.com" },
  collector: "https://stats.example.com",
  hosting: "on a server I run at home in Colorado",
  country: "the United States",
  network: { name: "Cloudflare", privacyUrl: "https://www.cloudflare.com/privacypolicy/" },
  retentionDays: 90,
  updated: "2026-09-22",
});
```

It returns the notice body as HTML with `<h2>` sections for the page's own layout.
The opt-out control is hidden until the module runs, because it cannot work without JavaScript.
The notice describes this package's events, so a release that changes what is collected also changes the notice, and consumers should republish their privacy page with a new `updated` date.
The notice promises that records are deleted after `retentionDays`; Umami does not delete anything itself, so the collector's operator must run that deletion.
`privacyNotice` rejects inputs that would render wrong or unsafe: a non-HTTPS collector or network URL, an email address with extra `mailto` parameters, a date that does not exist, or a retention period that is not a whole number of days.
It is written to meet the GDPR's transparency duties for a personal site, but it is not legal advice.

## Develop

```sh
pnpm install --frozen-lockfile
pnpm build          # dist/, with type declarations
pnpm check          # Biome, rumdl, tsc, Knip, node --test
pnpm test:browser   # Playwright against an HTTPS fixture and Umami's real tracker, port 4175
```

The browser tests run Umami 3.4.0's own tracker source, vendored unchanged in `test/fixture/umami/` under its MIT license, against a fixture served over HTTPS with a throwaway self-signed certificate (the tests need `openssl`).
When the collector upgrades, replace that file with the new release's `src/tracker/index.ts` and rerun the tests.

## Releases

Versions follow [Conventional Commits](https://www.conventionalcommits.org/) through release-please.
Adding an event, a payload field, or anything else that widens collection is `feat` and must update the notice in the same change; removing or renaming an export is `feat!`.
Merging the release PR tags the version, and `.github/workflows/release.yml` builds, tests, and stages it on npm as a trusted publisher with provenance.
Packing refuses to run without a built `dist/`, so the published files are the ones the release job tested.
The owner approves each staged version with 2FA before it goes live.

## License

[MIT](LICENSE)
