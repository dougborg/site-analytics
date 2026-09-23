# CLAUDE.md

Privacy-respecting Umami analytics published as `@dougborg/site-analytics`.
The [README](README.md) is the adoption guide, the collection contract, and the release policy.

## Commands

Use the pinned Node (`.nvmrc`) and pnpm (`packageManager`); run from the repo root.

```sh
pnpm install --frozen-lockfile
pnpm build          # dist/ (ignored by git)
pnpm check          # Biome, rumdl, tsc, Knip, node --test
pnpm test:browser   # Playwright on the fixture page, port 4175
```

Run `actionlint` after editing workflows.

## Invariants

- The README table, `src/notice.ts`, and `src/analytics.ts` describe the same collection; change all three together and cover the change in tests.
- Widening collection is `feat`; removing or renaming an export or event is `feat!`.
- Never collect typed input, link text, email addresses, element classes, or click positions, and never call `umami.identify`.
- Global Privacy Control, Do Not Track, the opt-out flag, non-HTTPS pages, other hostnames, frames, prerendering, automation, and a missing or invalid config prevent the tracker from loading at all.
- The browser module revalidates its config and never trusts page markup; the `before-send` hook stays non-writable and drops any event this module did not send.
- Browser tests run Umami's real tracker from `test/fixture/umami/`; keep that file byte-identical to the pinned release and excluded from formatting.
- Analytics never delays rendering, navigation, or downloads.
- Biome cognitive complexity stays at most 15 per function.
- Write one sentence per line in Markdown.
- Conventional Commits with lowercase subjects; release-please derives versions and the changelog from them.
- Never publish to npm by hand after the first release; `.github/workflows/release.yml` is the stage-only trusted publisher, and the owner approves each staged version with 2FA.

## Consumers

[resume.dougborg.org](https://github.com/dougborg/resume) and [dougborg.org](https://github.com/dougborg/dougborg.github.io) use it with separate Umami website IDs.
