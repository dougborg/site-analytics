# @dougborg/site-analytics

Privacy-respecting [Umami](https://umami.is/) analytics for static sites.
It loads Umami's own tracker only when the visitor has not opted out, cleans every payload, sends only the events in a shared, typed collection contract, and ships the privacy notice that lists exactly that contract.

It is built for [resume.dougborg.org](https://resume.dougborg.org/) and [dougborg.org](https://dougborg.org/), both counted by a self-hosted Umami at `stats.dougborg.net`.
It supports the Umami version that collector runs, 3.4.0; see [Compatibility](#compatibility).

## What it collects

| Event | When | Data |
| --- | --- | --- |
| Page view | Each page load and history navigation (Umami) | URL keeping only `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, and `utm_term`; title; referrer without query or fragment; screen; language |
| `performance` | Page load (Umami) | Web Vitals: TTFB, FCP, LCP, CLS, INP (the tracker also sends the time open, which Umami 3.4.0 discards) |
| `scroll-depth` | The first time the visitor, after scrolling themselves, reaches 25, 50, 75, or 100 percent of a page that scrolls | `depth` |
| `engaged-time` | Each time the page is hidden or left | `seconds` visible since the last report, at most 3600; their sum is the page's total |
| `outbound-click` | A click or middle click on a link or image-map area to another origin | `url`: origin and path only |
| `download-click` | A link with `download`, or a same-origin link to a `pdf`, `docx`, `md`, `json`, `zip`, `csv`, `txt`, or `epub` file | `format`: one of those types, or `file` for any other; `file` name |
| `contact-click` | A `mailto:` or `tel:` link | `method`: `email` or `phone`, never the address |
| `theme-toggle` | A click inside a control the site declared as its theme switch | `theme`: `light`, `dark`, or `system` |

The events and fields in this table are the collection contract, exported as `COLLECTION` (`BUILT_IN_EVENTS` plus `DECLARED_EVENTS`) from `src/contract.ts`.
The browser module drops any event that is not in it with exactly its fields and allowed values, and tests fail if this table, the privacy notice, or the contract list different events.

Anything that looks like an email address becomes `[email]`: a whole path segment that holds one (other segments keep their encoding), or the address inside a title or event value.
Campaign values containing `@` or longer than 100 characters are dropped, payload fields outside `PAYLOAD_FIELDS` are removed, and only the contract's events carry data.
Do not use Umami's own `data-umami-event` attributes: those events are dropped before sending, and Umami still takes over the click, which breaks a link's `download` attribute.

Umami's server combines the IP address and user agent with a server key and the current month to derive a session ID that is stable for the calendar month, plus an hourly visit ID, and derives coarse location and browser, OS, and device type; it stores those derived values but not the raw IP or user agent.
Session IDs differ between website IDs, but one server holds them all.

Nothing loads, and nothing is sent, when any of these hold:

- the browser sends Global Privacy Control or Do Not Track;
- the visitor opted out on the site's privacy page (Umami's `umami.disabled` local-storage flag);
- the page is not served over HTTPS from the configured production host, on its default port;
- the page is framed, prerendered and not yet shown, or the browser reports automation (`navigator.webdriver`);
- the config element is missing, duplicated, not a `script type="application/json"`, or invalid; the module rechecks the website ID and the HTTPS collector origin, so markup that cannot create `<script>` elements cannot redirect it.

It never calls `umami.identify`, drops any identify payload, and strips any distinct ID.
It sets no cookies, and it reads local storage only for the opt-out flag.
Clicks are never delayed: events go out with keepalive requests, at most 50 events wait for the tracker to load, and they are dropped if it never does.
The `before-send` hook is non-writable, so other scripts cannot remove the cleaning, and loading the module twice starts it once.
The config element's `data-state` attribute reports `blocked`, `loading`, `loaded`, or `failed` for debugging.

## Use

Install it, then render the config element and load the module on every tracked page:

```sh
pnpm add --save-exact @dougborg/site-analytics
```

The build-time API needs Node 22 or later, the oldest LTS line Node still supports; CI builds, tests, and installs the packed package on Node 22 as well as on the pinned development version in `.nvmrc`.
The browser module has no Node dependency at all.

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

A page that can be made to contain an attacker's `<script type="application/json" id="site-analytics">` can point the module at another collector, so treat any such injection as the script injection it is.
A Content Security Policy is the backstop: allow only your collector in `script-src` and `connect-src`, plus the module itself (Astro may inline it, which needs a hash or nonce).

### Declared events

A site may send only the declared events in `DECLARED_EVENTS`, today just `theme-toggle`.
Generate the control's attributes so that a name, field, or value outside the contract fails the build:

```ts
import { declaredEventAttributes } from "@dougborg/site-analytics";

declaredEventAttributes("theme-toggle", { theme: "dark" });
// data-analytics-event="theme-toggle" data-analytics-theme="dark"
```

A click inside the control sends the event.
The module ignores a declared event whose name, fields, or values are not exactly in the contract; a link inside such a control still counts as the link it is.
A new declared event, field, or value is a change to this package, never to a site: see [Releases](#releases).

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
They run in Chromium, Firefox, and WebKit; `pnpm exec playwright install chromium firefox webkit` fetches all three, and `--project=<engine>` runs one.

## Compatibility

### Umami

The supported collector is Umami 3.4.0, the version `stats.dougborg.net` runs.
The browser tests run that release's own tracker (`src/tracker/index.ts` at tag `v3.4.0`), pinned by its SHA-256 in `test/umami-fixture.test.ts`.
Every request they record must pass the 3.4.0 `/api/send` schema, transcribed in `test/browser/umami-server.ts`, and must not carry a distinct ID or any other field the server would accept but this package never sends.

Moving the collector to any other Umami version, including a 3.4.x patch, needs a compatibility review first:

1. Replace `test/fixture/umami/tracker.ts` with the new release's tracker and update the pinned hash.
2. Read the tracker's diff for new script attributes, payload fields, identifiers, or storage, and the `/api/send` schema's diff for new fields, and update `umami-server.ts`.
3. Run the whole suite in all three engines, and fix or document every difference.
4. Release this package with the new supported version stated here, then change the server image.

### Browsers

Every browser test runs in Chromium, Firefox, and WebKit, on Linux in CI.
Two engine differences are expected and covered by the tests.
Safari's WebKit trims a cross-site referrer to its origin before any script reads it, which only removes data.
Playwright cannot observe the keepalive requests Chromium sends while a page unloads, so the test for leaving a page checks what the page hands to `fetch` in every engine.
The module is ES2024; a browser too old to run it collects nothing, and the page works the same.

## Releases

Versions follow [Conventional Commits](https://www.conventionalcommits.org/) through release-please.
Adding an event, a field, an allowed value, or anything else that widens collection changes `src/contract.ts`; it is `feat`, needs a privacy review, and updates the README table in the same change (the notice follows the contract).
Removing or renaming an export or an event is `feat!`.
Merging the release PR tags the version, and `.github/workflows/release.yml` builds, tests, and stages it on npm as a trusted publisher with provenance.
Packing refuses to run without a built `dist/`, so the published files are the ones the release job tested.
The owner approves each staged version with 2FA before it goes live.
`0.2.0`, the bootstrap publish, is the one version without provenance; [Releasing](docs/releasing.md) is the operator runbook, including that exception and how to verify a staged release end to end.

## Consumers

Each site pins an exact version, uses its own Umami website ID for its own origin, and reviews any release that widens collection before upgrading.
[Consumers](docs/consumers.md) holds the upgrade rule and the matrix of sites, origins, website IDs, and pinned versions.

## License

[MIT](LICENSE)
