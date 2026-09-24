# Consumers

Every site that uses `@dougborg/site-analytics`, how each is configured, and the rules for upgrading.

## Consumer matrix

| Site | Origin | Repository | Umami website ID | Pinned version | Collecting |
| --- | --- | --- | --- | --- | --- |
| Résumé | `https://resume.dougborg.org` | [dougborg/resume](https://github.com/dougborg/resume) | `e3dd53c4-1676-47f1-9d59-577cbabaa490` | `0.3.0` | Yes, since 2026-09-24: dougborg/resume#95, dougborg/dougborg-dot-net#390 |
| Blog | `https://dougborg.org` | [dougborg/dougborg.github.io](https://github.com/dougborg/dougborg.github.io) | `86b4f907-4165-4c7b-9250-fe7402c5262f` | `0.3.0` | Yes, since 2026-09-24: dougborg/dougborg.github.io#7, dougborg/dougborg-dot-net#391 |
| Home page | `https://www.dougborg.net` | [dougborg/dougborg-dot-net](https://github.com/dougborg/dougborg-dot-net) (`services/dougborg-net-home`) | `7f262dd6-cb58-4296-b02a-a368f6ef3b9c` | `0.3.0`, vendored | Yes, since 2026-09-24: dougborg/dougborg-dot-net#566, dougborg/dougborg-dot-net#391 |

Website IDs are public by design: they ship in every tracked page.
The IDs, collector, and hostnames above match the config element each live site served on 2026-09-24.
The résumé and the blog pin the version in `package.json`.
`www.dougborg.net` has no build step, so `services/dougborg-net-home/scripts/sync-analytics.sh` vendors the release into that service and records it in its `analytics.json`.
The collector at `https://stats.dougborg.net` runs Umami 3.4.0 and accepts `GET`/`HEAD /script.js` and `POST`/`OPTIONS /api/send` only from exactly these three origins.
Keep this table, the Umami websites, and the collector's origin allowlist in step.

## One website ID per origin

- Each origin gets its own Umami website and its own ID, and no ID is ever reused, so a visitor's activity on one site is not linked to another.
  Umami derives session IDs per website, but one server holds them all, as the privacy notice says.
- `https://dougborg.org` and `https://www.dougborg.net` are different origins, and so are an apex and its `www`; each is a separate row.
- `configElement({ hostname })` must be the origin's host, with no port; the module refuses to load anywhere else.
- A new site needs a new Umami website, a new row here, and an origin added to the collector's allowlist in dougborg-dot-net, before its first deploy with analytics.

## Upgrade rule

1. **Pin exact versions**: `"@dougborg/site-analytics": "X.Y.Z"`, never a range, and commit the lockfile.
   The résumé copies `dist/analytics.js` byte for byte, and `www.dougborg.net` vendors it with its integrity checked against the registry, so the pin fixes exactly what visitors run.
2. **Never auto-merge** an update of this package, from Dependabot, Renovate, or anyone.
3. **Read the changelog.**
   A `fix` or a narrowing change can ship once the site's own tests pass.
4. **A release that widens collection** (a `feat` that adds an event, a field, or an allowed value to the collection contract) needs, in the consumer PR:
   - a privacy review of what the new data could reveal about a visitor;
   - the privacy page regenerated with `privacyNotice()` and a new `updated` date;
   - a rollout one site at a time, checking the collector's data after each.
5. **A breaking release** (`feat!`) needs the site's markup checked: for example, a declared event the contract no longer allows is dropped silently.
6. Upgrade the consumers only after the version's provenance has been verified (see [Releasing](releasing.md)).

## Declared events

A site may declare only the events in `DECLARED_EVENTS`, today `theme-toggle`.
Build the attributes with `declaredEventAttributes()`, so a typo fails the site's build.
A new declared event, field, or value is a change to this package, reviewed here, never a site-local addition.
