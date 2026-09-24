# Changelog

## [0.4.0](https://github.com/dougborg/site-analytics/compare/v0.3.0...v0.4.0) (2026-09-24)


### ⚠ BREAKING CHANGES

* privacyNotice() takes `analytics` (the site's AnalyticsConfig, the same object passed to configElement) in place of `collector`. The notice and the module include a declared event such as theme-toggle only when the config lists it in `declaredEvents`; a site that sends theme-toggle must add it. Replace any copied analytics.js in the same change.

### Features

* disclose and send only the declared events a site lists ([c4ec9b3](https://github.com/dougborg/site-analytics/commit/c4ec9b316096b6a813d6b7d310a052857d576cbc))

## [0.3.0](https://github.com/dougborg/site-analytics/compare/v0.2.0...v0.3.0) (2026-09-23)


### ⚠ BREAKING CHANGES

* build page views from the page, never from caller values ([#13](https://github.com/dougborg/site-analytics/issues/13))
* enforce a typed collection contract for every event ([#9](https://github.com/dougborg/site-analytics/issues/9))

### Features

* enforce a typed collection contract for every event ([#9](https://github.com/dougborg/site-analytics/issues/9)) ([8bad6d0](https://github.com/dougborg/site-analytics/commit/8bad6d0955e87aca7068e39226a46aeae7b13eb6))


### Bug Fixes

* build page views from the page, never from caller values ([#13](https://github.com/dougborg/site-analytics/issues/13)) ([cc6e3c0](https://github.com/dougborg/site-analytics/commit/cc6e3c089d9890cd97c27a5c6a71941261f928fb))

## [0.2.0](https://github.com/dougborg/site-analytics/compare/v0.1.0...v0.2.0) (2026-09-23)


### ⚠ BREAKING CHANGES

* `privacyNotice` requires `country` and rejects invalid inputs.

### Bug Fixes

* harden the tracker and notice after an adversarial review ([#4](https://github.com/dougborg/site-analytics/issues/4)) ([e1b605b](https://github.com/dougborg/site-analytics/commit/e1b605bf65280bf99d8320e7529324f61619c0d7))
