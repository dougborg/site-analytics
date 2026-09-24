# CLAUDE.md

Privacy-respecting Umami analytics published as `@dougborg/site-analytics`.
The [README](README.md) is the adoption guide, the collection contract, and the release policy.

## Commands

Use the pinned Node (`.nvmrc`) and pnpm (`packageManager`); run from the repo root.

```sh
pnpm install --frozen-lockfile
pnpm build          # dist/ (ignored by git)
pnpm check          # Biome, rumdl, tsc, Knip, node --test
pnpm test:browser   # Playwright in Chromium, Firefox, and WebKit, port 4175
```

Run `actionlint` after editing workflows.

## Invariants

- `src/contract.ts` is the collection contract: every named event, field, and allowed value; the browser module drops anything outside it.
  The README table and the contract must agree, and the notice's event list is generated from it: the built-in events plus the site's `declaredEvents`, the same list the module sends.
  `test/contract.test.ts` fails when any of these disagree; change them together.
- A site sends a declared event only if its config lists it in `declaredEvents`; `siteEvents()` in `src/contract.ts` is the one definition of what a site can send, used by both the module and the notice, and `privacyNotice` takes the site's config rather than its own copy of the list.
- `undisclosedEvents()` over-reports rather than misses: it must find every config and declared-event attribute the browser would accept, however the markup is written, so it scans the raw text for JSON objects and attribute names instead of tokenising HTML.
- Declared events take only fixed choices; a new event, field, or value needs a privacy review, and `test/contract.test.ts` rejects names and values that could carry personal data.
- `src/contract.ts` has no imports: `scripts/inline-contract.ts` inlines it so the published `dist/analytics.js` stays one self-contained file.
- Widening collection is `feat`; removing or renaming an export or event is `feat!`.
- Never collect typed input, link text, email addresses, element classes, or click positions, and never call `umami.identify`.
- Global Privacy Control, Do Not Track, the opt-out flag, non-HTTPS pages, other hostnames, frames, prerendering, automation, and a missing or invalid config prevent the tracker from loading at all.
- The browser module revalidates its config and never trusts page markup; the `before-send` hook stays non-writable and drops any event this module did not send.
- Browser tests run Umami's real tracker from `test/fixture/umami/` in Chromium, Firefox, and WebKit; keep that file byte-identical to the supported release (its hash is pinned in `test/umami-fixture.test.ts`) and excluded from formatting.
- Changing the supported Umami version follows the review in README "Compatibility".
- Analytics never delays rendering, navigation, or downloads.
- Biome cognitive complexity stays at most 15 per function.
- Write one sentence per line in Markdown.
- Conventional Commits with lowercase subjects; release-please derives versions and the changelog from them.
- Never publish to npm by hand after the first release; `.github/workflows/release.yml` is the stage-only trusted publisher, and the owner approves each staged version with 2FA.

## Consumers

[docs/consumers.md](docs/consumers.md) is the consumer matrix (résumé, blog, `www.dougborg.net`) with one Umami website ID per origin, and the upgrade rule: exact pins, and a privacy review plus a new notice date for any release that widens collection.
Update it whenever a site adopts, upgrades, or changes its website ID.

## Releasing

[docs/releasing.md](docs/releasing.md) is the npm runbook.
Agents never publish, tag, create Releases, approve staged versions, or merge release-please PRs; those are the owner's steps.
